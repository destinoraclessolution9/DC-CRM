// ci/test-basic-info-selects.js — the shared prospect/customer basic-info form's
// <select> controls, and the free-text columns behind them (gender, title).
//
// WHY: buildBasicInfoBlock is save-the-whole-record — collectBasicInfoData
// re-emits every field from the DOM on save. So a <select> that fails to match
// its stored value does not merely render wrong, it OVERWRITES the DB with
// whatever option 0 happens to be. Two columns were hit:
//
//   gender — free text holding six spellings of two values ('Female'/'female'/
//     'F' · 'Male'/'male'/'M'); the select compared by strict equality, so
//     'female' matched no <option>, the browser fell back to option 0 ('Male'),
//     and the save wrote Male — which drives Ming Gua and the client life chart.
//   title  — same defect, and worse, because option 0 is 'Mr.': every
//     title-less prospect that was opened and saved got stamped Mr. The
//     2026-08-05 audit found 23 prospects titled Mr. whose gender was Female,
//     all independently confirmed Female by their ming_gua.
//
// The fix in both cases is a blank first <option> plus tolerant matching, so
// these tests assert on WHAT A BROWSER WOULD SUBMIT, not on how it looks.
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

// ── 2b. The title <select> — same defect, option 0 is 'Mr.' ────────────────
const ttlStart = activitiesSrc.indexOf('<select id="${prefix}-title"');
ok('title <select> found in buildBasicInfoBlock', ttlStart !== -1);
const ttlTpl = activitiesSrc.slice(ttlStart, activitiesSrc.indexOf('</select>', ttlStart) + '</select>'.length);

const _biTitle = sliceArrow(activitiesSrc, '    const _biTitle = ', '\n    };');
const BASIC_INFO_TITLES = sliceArrow(activitiesSrc, '    const BASIC_INFO_TITLES = ', '];');
ok('_biTitle is declared in chunks/script-activities.js', typeof _biTitle === 'function');
eq('BASIC_INFO_TITLES is the canonical set', (BASIC_INFO_TITLES || []).join('|'), 'Mr.|Ms.|Mrs.|Dr.');

const renderTitle = (storedTitle) => {
    const prefix = 'prospect';
    const disabled = '';
    const d = { title: storedTitle };
    const sel = (v, opt) => v === opt ? 'selected' : '';
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return eval('`' + ttlTpl + '`');
};

for (const [stored, want, label] of [
    ['Mr.',  'Mr.',  'Mr.'],
    ['Ms.',  'Ms.',  'Ms.'],
    ['Mrs.', 'Mrs.', 'Mrs. is NOT collapsed to Ms. — it carries marital info'],
    ['Dr.',  'Dr.',  'Dr. is gender-neutral, left alone'],
    ['mr',   'Mr.',  'lowercase, no dot'],
    ['MS.',  'Ms.',  'shout case'],
    [' mrs ', 'Mrs.', 'whitespace padded'],
]) {
    eq(`title select round-trips ${label}`, submittedValue(renderTitle(stored)), want);
}
// The exact 2026-08-05 corruption: a title-less prospect must NOT become Mr.
eq('title: NULL submits blank, not Mr.',      submittedValue(renderTitle(null)), '');
eq('title: undefined submits blank, not Mr.', submittedValue(renderTitle(undefined)), '');
eq('title: empty submits blank, not Mr.',     submittedValue(renderTitle('')), '');
ok('title select leads with a blank placeholder option', /^<select[^>]*>\s*<option value=""/.test(renderTitle(null)));
// Malaysian honorifics are real values, not typos — never rewritten, never dropped.
for (const t of ["Dato'", 'Datuk', 'Tan Sri', 'Puan Sri']) {
    eq(`title preserves the honorific ${t}`, submittedValue(renderTitle(t)), t);
}

// ── 2c. Structural guard — the defect that hit gender AND title ────────────
// Any <select> in this form that reflects a STORED value must lead with a blank
// option, or an unmatched/absent value silently resolves to option 0 and the
// save-the-whole-record form persists it. Three controls default on purpose and
// are exempt: country falls back to cuHomeCountry(), credit defaults to 'me',
// and assign-agent is populated asynchronously.
const DELIBERATE_DEFAULTS = new Set(['country', 'credit', 'assign-agent']);
const formBody = activitiesSrc.slice(
    activitiesSrc.indexOf('const buildBasicInfoBlock'),
    activitiesSrc.indexOf('const collectBasicInfoData'));
const selectRe = /<select id="\$\{prefix\}-([a-z-]+)"[\s\S]{0,700}?<\/select>/g;
let sm, checked = 0;
while ((sm = selectRe.exec(formBody))) {
    const [frag, name] = [sm[0], sm[1]];
    if (DELIBERATE_DEFAULTS.has(name)) continue;
    checked++;
    ok(`<select ${name}> leads with a blank option (no silent option-0 write)`,
        /<option value=""/.test(frag));
}
ok('structural guard actually inspected the value-bearing selects', checked >= 5, `checked ${checked}`);

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

const _impTitle = sliceArrow(importSrc, 'const _impTitle = ', '\n};');
ok('_impTitle is declared in chunks/script-import.js', typeof _impTitle === 'function');
for (const [input, want] of [['mr', 'Mr.'], ['MRS.', 'Mrs.'], ['Ms', 'Ms.'], ['dr.', 'Dr.'],
                             ["Dato'", "Dato'"], ['', ''], [null, '']]) {
    eq(`_impTitle(${JSON.stringify(input)})`, _impTitle(input), want);
}
// Only the PROSPECT title is normalized. The events import also has a `title`
// field — that one is an event NAME and must never be touched.
ok('import normalizes the prospect title but not the event title',
    /title: _impTitle\(get\('title'\)\)/.test(importSrc)
    && /if \(type === 'events'\) return \{ title: get\('title'\)/.test(importSrc));

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
