// ci/test-gender-casing.js — prospects.gender / customers.gender casing.
//
// WHY: both columns are free text and held six spellings of two values
// ('Female'/'female'/'F' · 'Male'/'male'/'M'). Every site that COMPARES the
// column expected the capitalized pair, so the other four spellings matched
// nothing. The worst of those was not a render bug but a WRITE: the shared
// basic-info <select> matched by strict equality, an unmatched value selected
// no <option>, the browser fell back to option 0 ('Male'), and the
// save-the-whole-record form wrote that fallback back to the DB — silently
// flipping a lowercase-'female' prospect to Male, which drives Ming Gua and the
// client life chart.
//
// HARNESS: every function under test is SLICED OUT OF THE REAL SOURCE and
// eval'd, never copied here — so a drift between the shipped chunk and these
// expectations fails the test instead of being papered over. The gender <select>
// is likewise sliced from the real template literal and rendered, so the
// assertions are about the HTML the app actually emits.
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
const eq = (name, got, want) => ok(name, got === want, `got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Slice `const <name> = <expr>;` out of a source file and eval the expression.
const sliceArrow = (src, decl, endMarker) => {
    const start = src.indexOf(decl);
    if (start === -1) return null;
    const end = src.indexOf(endMarker, start);
    if (end === -1) return null;
    return eval('(' + src.slice(start + decl.length, end + endMarker.length - 1) + ')');
};

const activitiesSrc = read('chunks/script-activities.js');
const searchSrc     = read('chunks/script-search.js');
const importSrc     = read('chunks/script-import.js');
const dataSrc       = read('data.js');

// ── 1. _biGender — the basic-info form's read-side normalizer ───────────────
const _biGender = sliceArrow(activitiesSrc, '    const _biGender = ', '\n    };');
ok('_biGender is declared in chunks/script-activities.js', typeof _biGender === 'function');

const GENDER_CASES = [
    ['Female', 'Female', 'already canonical'],
    ['Male',   'Male',   'already canonical'],
    ['female', 'Female', 'lowercase — 184 prospects'],
    ['male',   'Male',   'lowercase — 163 prospects'],
    ['F',      'Female', 'bare initial — matched nothing before'],
    ['M',      'Male',   'bare initial — matched nothing before'],
    ['  female  ', 'Female', 'whitespace padded'],
    ['FEMALE', 'Female', 'shout case'],
    ['Other',  'Other',  'third canonical option'],
    ['other',  'Other',  'third option, lowercase'],
    ['女',     'Female', 'Chinese'],
    ['男',     'Male',   'Chinese'],
    ['',       '',       'empty stays empty (unset, not Male)'],
    ['   ',    '',       'whitespace-only stays empty'],
    [null,     '',       'null stays empty'],
    [undefined, '',      'undefined stays empty'],
    ['Lelaki', 'Lelaki', 'unrecognized preserved verbatim, never guessed'],
];
for (const [input, want, label] of GENDER_CASES) {
    eq(`_biGender: ${label}`, _biGender(input), want);
}

// ── 2. The rendered <select> — the actual regression ────────────────────────
// Slice the real template block so the assertions pin emitted HTML, not a copy.
const selStart = activitiesSrc.indexOf('<select id="${prefix}-gender"');
ok('gender <select> found in buildBasicInfoBlock', selStart !== -1);
const selEnd = activitiesSrc.indexOf('</select>', selStart);
const selTpl = activitiesSrc.slice(selStart, selEnd + '</select>'.length);

const BASIC_INFO_GENDERS = sliceArrow(activitiesSrc, '    const BASIC_INFO_GENDERS = ', '];');
ok('BASIC_INFO_GENDERS is declared', Array.isArray(BASIC_INFO_GENDERS));
eq('BASIC_INFO_GENDERS is the canonical set', BASIC_INFO_GENDERS.join('|'), 'Male|Female|Other');

const renderSelect = (storedGender) => {
    const prefix = 'prospect';
    const disabled = '';
    const d = { gender: storedGender };
    const sel = (v, opt) => v === opt ? 'selected' : '';
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    // Wrapped raw: the fragment's own backticks belong to a nested template
    // literal inside ${…} and must stay live, not be escaped.
    return eval('`' + selTpl + '`');
};
// Which option would the BROWSER submit? The first one carrying `selected`, else
// option 0 — this is precisely the fallback that corrupted the stored value.
const submittedValue = (html) => {
    const opts = [...html.matchAll(/<option value="([^"]*)"([^>]*)>/g)].map(m => ({ value: m[1], sel: /selected/.test(m[2]) }));
    const chosen = opts.find(o => o.sel) || opts[0];
    return chosen ? chosen.value : null;
};

// The bug, pinned: every stored spelling must round-trip to itself, unchanged.
for (const [stored, want, label] of [
    ['Female', 'Female', 'Female'],
    ['female', 'Female', 'female (was silently saved as Male)'],
    ['F',      'Female', 'F (was silently saved as Male)'],
    ['Male',   'Male',   'Male'],
    ['male',   'Male',   'male'],
    ['M',      'Male',   'M'],
    ['Other',  'Other',  'Other'],
]) {
    eq(`select round-trips ${label}`, submittedValue(renderSelect(stored)), want);
}

// Unset must stay unset — a blank first option, NOT a silent 'Male' default.
eq('select: NULL gender submits blank, not Male',      submittedValue(renderSelect(null)), '');
eq('select: undefined gender submits blank, not Male', submittedValue(renderSelect(undefined)), '');
eq('select: empty gender submits blank, not Male',     submittedValue(renderSelect('')), '');
ok('select leads with a blank placeholder option', /^<select[^>]*>\s*<option value=""/.test(renderSelect(null)));

// An unrecognized value must be preserved, not silently rewritten on save.
eq('select preserves an unrecognized value', submittedValue(renderSelect('Lelaki')), 'Lelaki');

// ── 3. Search filter — client side + pushed-down predicate ─────────────────
const _genderKey   = sliceArrow(searchSrc, '    const _genderKey = ', ";");
const _genderIlike = sliceArrow(searchSrc, '    const _genderIlike = ', '\n    };');
ok('_genderKey is declared in chunks/script-search.js', typeof _genderKey === 'function');
ok('_genderIlike is declared in chunks/script-search.js', typeof _genderIlike === 'function');

// The filter dropdown only offers 'Male'/'Female'; all six stored spellings must match.
for (const stored of ['Female', 'female', 'F', ' female ']) {
    eq(`filter Female matches stored ${JSON.stringify(stored)}`, _genderKey(stored), _genderKey('Female'));
}
for (const stored of ['Male', 'male', 'M', 'MALE']) {
    eq(`filter Male matches stored ${JSON.stringify(stored)}`, _genderKey(stored), _genderKey('Male'));
}
ok('filter Female does NOT match a male row', _genderKey('male') !== _genderKey('Female'));
eq('_genderKey: null is not a match for anything', _genderKey(null), '');
ok('unset row is excluded when a gender filter is set', _genderKey(null) !== _genderKey('Female'));

// The pattern's own case is irrelevant — ilike is case-insensitive on both
// sides — but it must be the anchored single-letter prefix, so 'F%' catches
// 'Female', 'female' AND the bare 'F' rows in one predicate.
eq('_genderIlike: Female → f%', _genderIlike('Female'), 'f%');
eq('_genderIlike: Male → m%',   _genderIlike('Male'), 'm%');
eq('_genderIlike: empty → null (no predicate pushed)', _genderIlike(''), null);
eq('_genderIlike: non-letter is refused, never interpolated', _genderIlike('%'), null);
eq('_genderIlike: null → null', _genderIlike(null), null);

// Pushed-down predicate must go through ilike, never the case-SENSITIVE eq map.
ok('prospect search pushes gender via ilike, not filters',
    /opts\.ilike\.gender = _genderIlike\(/.test(searchSrc) && !/opts\.filters\.gender\s*=/.test(searchSrc));
ok('customer search pushes gender via ilike, not filters',
    /baseIlike\.gender = _genderIlike\(/.test(searchSrc) && !/baseFilters\.gender\s*=/.test(searchSrc));
ok('customer mkOpts threads baseIlike into queryAdvanced', /ilike:\s*\{\s*\.\.\.baseIlike\s*\}/.test(searchSrc));
ok('no case-sensitive gender equality survives in the search chunk',
    !/i\.gender === filters\.basic\.gender/.test(searchSrc));

// ── 4. data.js must actually honour the ilike option ───────────────────────
ok('queryAdvanced applies options.ilike via .ilike()',
    /if \(options\.ilike\) \{[\s\S]{0,400}?q = q\.ilike\(key, value\)/.test(dataSrc));
ok('queryAdvanced documents the ilike option', /ilike:\s+\{ gender: 'F%' \}/.test(dataSrc));

// ── 5. Import — the write boundary that produced the mixed casing ──────────
const _impGender = sliceArrow(importSrc, 'const _impGender = ', '\n};');
ok('_impGender is declared in chunks/script-import.js', typeof _impGender === 'function');
for (const [input, want] of [['female', 'Female'], ['MALE', 'Male'], ['F', 'Female'], ['m', 'Male'],
                             ['other', 'Other'], ['', ''], [null, ''], ['女', 'Female']]) {
    eq(`_impGender(${JSON.stringify(input)})`, _impGender(input), want);
}
ok('import normalizes every gender write site',
    (importSrc.match(/gender: _impGender\(get\('gender'\)\)/g) || []).length === 2
    && !/gender: get\('gender'\)/.test(importSrc));

// ── 6. Migration ───────────────────────────────────────────────────────────
const MIG = 'migrations/gender_normalize_2026-08-05.sql';
ok(`${MIG} exists`, fs.existsSync(path.join(ROOT, MIG)));
if (fs.existsSync(path.join(ROOT, MIG))) {
    const mig = read(MIG);
    for (const t of ['prospects', 'customers']) {
        ok(`migration normalizes ${t}`, new RegExp(`update public\\.${t}`).test(mig));
        ok(`migration constrains ${t}`, new RegExp(`${t}_gender_canonical`).test(mig));
    }
    ok('migration bumps updated_at (neither table has an updated_at trigger)',
        (mig.match(/updated_at = now\(\)/g) || []).length === 2);
    ok('CHECK allows exactly the canonical set + NULL',
        /check \(gender is null or gender in \('Male', 'Female', 'Other', ''\)\)/.test(mig));
    ok('migration leaves cps_analyses alone (different table, consistently lowercase)',
        !/cps_analyses\s*\n?\s*set|update public\.cps_analyses/.test(mig));
}

// ── 7. Tables that legitimately store lowercase must NOT have been touched ──
const fudeSrc = read('chunks/script-fude.js');
const orgSrc  = read('chunks/script-org.js');
ok('cps_analyses form still matches lowercase (its column is 100% lowercase)',
    /data\.gender === 'female'/.test(fudeSrc) && /data\.gender === 'male'/.test(fudeSrc));
ok('org member form still matches lowercase (its own writes are lowercased)',
    /m\.gender === 'male'/.test(orgSrc) && /m\.gender === 'female'/.test(orgSrc));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
