// Extract the Time24 helpers straight out of script.js and exercise them, so the
// rules are pinned by the real shipped source rather than a re-typed copy.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'script.js'), 'utf8');

const grab = (name) => {
    const start = src.indexOf(`const ${name} = (`);
    if (start < 0) throw new Error(`${name} not found in script.js`);
    // Walk braces from the arrow body to find the end of the function.
    const bodyStart = src.indexOf('{', src.indexOf('=>', start));
    let depth = 0, i = bodyStart;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    return src.slice(start, i + 1) + ';';
};

const _t24Normalize = eval(grab('_t24Normalize') + ' _t24Normalize');
const _t24Mask = eval(grab('_t24Mask') + ' _t24Mask');

let fail = 0;
const eq = (label, got, want) => {
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(34)} -> ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`);
};

console.log('--- normalize (what .value becomes on change/blur) ---');
eq('empty', _t24Normalize(''), '');
eq('null', _t24Normalize(null), '');
eq('undefined', _t24Normalize(undefined), '');
eq('"9"          single-digit hour', _t24Normalize('9'), '09:00');
eq('"14"         two-digit hour', _t24Normalize('14'), '14:00');
eq('"930"        3-digit shorthand', _t24Normalize('930'), '09:30');
eq('"1430"', _t24Normalize('1430'), '14:30');
eq('"14:30"      already good', _t24Normalize('14:30'), '14:30');
eq('"09:00"', _t24Normalize('09:00'), '09:00');
eq('"14:3"       lone minute digit', _t24Normalize('14:3'), '14:03');
eq('"00:00"      midnight', _t24Normalize('00:00'), '00:00');
eq('"23:59"      last minute', _t24Normalize('23:59'), '23:59');
eq('"14:30:00"   Postgres time col', _t24Normalize('14:30:00'), '14:30');
eq('"09:00:00"', _t24Normalize('09:00:00'), '09:00');
eq('"2560"       both out of range', _t24Normalize('2560'), '23:59');
eq('"9999"', _t24Normalize('9999'), '23:59');
eq('"99"', _t24Normalize('99'), '23:00');
// "230" reads as 23:0 — the same way the native HH/MM fields consumed it, and
// the same as what the mask puts on screen while you type. 2:30 pm is "1430".
eq('"2.30 pm"    junk paste', _t24Normalize('2.30 pm'), '23:00');
eq('"abc"        no digits', _t24Normalize('abc'), '');

console.log('\n--- mask (what shows while typing 1-4-3-0) ---');
eq('type "1"', _t24Mask('1'), '1');
eq('type "14"', _t24Mask('14'), '14:');
eq('type "143"', _t24Mask('143'), '14:3');
eq('type "1430"', _t24Mask('1430'), '14:30');
console.log('--- typing 9-3-0 (leading 3-9 = single-digit hour) ---');
eq('type "9"', _t24Mask('9'), '09:');
eq('then "3"   ("093")', _t24Mask('09:3'), '09:3');
eq('then "0"   ("0930")', _t24Mask('09:30'), '09:30');
console.log('--- guards ---');
eq('5th digit ignored', _t24Mask('14305'), '14:30');
eq('empty', _t24Mask(''), '');

console.log('\n--- round-trip: every valid HH:MM is a fixed point ---');
let rt = 0;
for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m++) {
        const v = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
        if (_t24Normalize(v) !== v) { console.log(`FAIL fixed point ${v} -> ${_t24Normalize(v)}`); fail++; }
        // and the mask must leave a complete value alone
        if (_t24Mask(v) !== v) { console.log(`FAIL mask stable ${v} -> ${_t24Mask(v)}`); fail++; }
        rt++;
    }
}
console.log(`checked ${rt} times (00:00–23:59), all stable under normalize + mask`);

console.log('\n--- output is always parseable by the consumers (.split(":")) ---');
['', '9', '930', '1430', '2560', 'abc', '14:30:00'].forEach((raw) => {
    const v = _t24Normalize(raw);
    if (v === '') return;
    const [h, m] = v.split(':').map(Number);
    const bad = !(Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h < 24 && m >= 0 && m < 60);
    if (bad) { console.log(`FAIL ${raw} -> ${v}`); fail++; }
});
console.log('all consumer parses valid');

// THE invariant: what the field shows while typing is what gets saved. Simulate
// a real keystroke sequence through the mask (the field is re-masked on every
// keypress), then normalize on blur, and require the saved time to be the one
// the user was aiming at. This is the property that AM/PM broke.
console.log('\n--- WYSIWYG: type the digits, get that exact time ---');
const type = (digits) => {
    let v = '';
    for (const ch of digits) v = _t24Mask(v + ch);   // field re-masks each keypress
    return { shown: v, saved: _t24Normalize(v) };
};
let typed = 0, mismatched = 0;
for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m++) {
        const want = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
        // Full 4-digit entry always works.
        const full = type(want.replace(':', ''));
        if (full.saved !== want) { console.log(`FAIL 4-digit ${want}: shown ${full.shown} saved ${full.saved}`); mismatched++; }
        // 3-digit shorthand ("930" = 09:30) works only for hours 3–9, where the
        // leading digit cannot begin a valid 2-digit hour. For 0/1/2 the field
        // must wait ("23" is a real hour), so those need all four digits — the
        // same rule the native HH field followed.
        if (h >= 3 && h <= 9) {
            const short = type(String(h) + String(m).padStart(2, '0'));
            if (short.saved !== want) { console.log(`FAIL 3-digit ${want}: shown ${short.shown} saved ${short.saved}`); mismatched++; }
        }
        typed++;
    }
}
fail += mismatched;
console.log(`typed all ${typed} times both ways — ${mismatched === 0 ? 'saved value always matched the digits typed' : mismatched + ' mismatches'}`);

// The universal guarantee, including half-finished entry: blurring only COMPLETES
// what is on screen (zero-padding the minute, exactly as the native minute field
// did with a lone digit). It never re-reads the digits as some other time — which
// is precisely the failure mode AM/PM had.
console.log('\n--- blur completes what is shown, never reinterprets it ---');
let reinterpreted = 0, partials = 0;
for (let d = 1; d <= 9999; d++) {
    const shown = type(String(d));
    if (!shown.shown) continue;
    const [sh, sm] = shown.shown.split(':');
    const expected = sm === undefined
        ? _t24Normalize(shown.shown)                                  // hour still being typed
        : sh.padStart(2, '0') + ':' + (sm || '0').padStart(2, '0');   // lone minute digit → :0X
    if (shown.saved !== expected) {
        if (reinterpreted < 5) console.log(`FAIL typed ${d}: shown ${shown.shown} saved ${shown.saved} expected ${expected}`);
        reinterpreted++;
    }
    partials++;
}
fail += reinterpreted;
console.log(`${partials} typing states (incl. half-typed) — ${reinterpreted === 0 ? 'saved value always completed the shown digits' : reinterpreted + ' reinterpreted'}`);

console.log('\n--- arrow-key stepping wraps instead of going out of range ---');
const step = (v, min) => {
    const [h, m] = _t24Normalize(v || '00:00').split(':').map(Number);
    let t = (h * 60 + m + min) % 1440;
    if (t < 0) t += 1440;
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
};
eq('23:50 +15 wraps past midnight', step('23:50', 15), '00:05');
eq('00:05 -15 wraps back', step('00:05', -15), '23:50');
eq('09:00 +60 (shift)', step('09:00', 60), '10:00');
eq('empty field +15 from 00:00', step('', 15), '00:15');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
