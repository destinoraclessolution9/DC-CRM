// ci/test-paste-guess.js — Paste Info with no labels (2026-11-02).
// Owner's example: five bare lines (name / IC / job / phone / email) used to
// say "No recognizable fields found". Labels still run first; a blank field is
// then found by its shape, and Name / Occupation are guesses that only fill
// empty boxes. Also: the May/Jun appointment-date fix, and a blank label
// ("Occupation:") no longer taking the next line.
//
// HARNESS: functions are SLICED OUT OF THE REAL SOURCE and eval'd (same
// pattern as test-paste-appointment.js), never copied.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const eq = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++;
    console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const cut = (src, decl, end) => {
    const start = src.indexOf(decl);
    if (start === -1) throw new Error('not found: ' + decl.trim());
    return src.slice(start + decl.length, src.indexOf(end, start) + end.length - 1);
};
const act = read('chunks/script-activities.js');
const cps = read('chunks/script-cps.js');
const a = (decl, end = '\n    };') => cut(act, `    const ${decl} = `, end);
const c = (decl, end = '\n};') => cut(cps, `const ${decl} = `, end);

const _MONTHS = eval('(' + a('_MONTHS', '};') + ')');
const _ymd = eval('(' + a('_ymd') + ')');
const parseApptDate = eval('(' + a('parseApptDate') + ')');
const parseApptTime = eval('(' + a('parseApptTime') + ')');
const _normText = eval('(' + a('_normText', ';\n').replace(/;$/, '') + ')');
let VENUES = [];
const _getVenuesCached = async () => VENUES;
const pasteApptLineTest = eval('(' + a('pasteApptLineTest') + ')');

const _PASTE_LABEL = eval(c('_PASTE_LABEL', ';\n').replace(/;$/, ''));
const _PASTE_CHATTER = eval(c('_PASTE_CHATTER', ';\n').replace(/;$/, ''));
const _PASTE_NOT_NAME = eval(c('_PASTE_NOT_NAME', ';\n').replace(/;$/, ''));
const _parseMalaysianIc = eval('(' + c('_parseMalaysianIc') + ')');
const _readPastedFields = eval('(' + c('_readPastedFields') + ')');

(async () => {
    VENUES = [
        { id: 1, name: 'Menara Bangkok Bank DC HQ', aliases: 'MBB, Menara Bangkok Bank, Bangkok Bank' },
        { id: 2, name: 'Far Coffee', aliases: 'Far Coffee Bukit Jalil' },
        { id: 3, name: 'Far Coffee', aliases: 'Far Coffee Sunway, Sunway Square' },
        { id: 4, name: 'Monalisa Bookstore', aliases: 'Monalisa, Monalisa Book Store, 御書閣' },
    ];
    const isAppt = await pasteApptLineTest();
    const read5 = (text) => {
        const { fields: f, guessed } = _readPastedFields(text, isAppt);
        return { got: [f.name, f.ic, f.occupation, f.phone, f.email], guessed };
    };
    const ex = ['Ngui Kok Feng', '831001105005', 'TCM', '010-8244914', 'kokfeng@gmail.com'];

    // [label, pasted text, want [name, ic, occupation, phone, email], want guessed]
    const CASES = [
        ["Owner's example", 'Ngui Kok Feng \n831001105005\nTCM\n0108244914\nkokfeng@gmail.com', ex, ['name', 'occupation']],
        ['Dashes and spaces', 'Ngui Kok Feng\n831001-10-5005\nTCM\n010-824 4914\nKokFeng@Gmail.com', ['Ngui Kok Feng', '831001-10-5005', 'TCM', '010-8244914', 'kokfeng@gmail.com']],
        ['Windows line ends', 'Ngui Kok Feng\r\n831001105005\r\nTCM\r\n0108244914\r\nkokfeng@gmail.com\r\n', ex],
        ['Numbered lines', '1. Ngui Kok Feng\n2. 831001105005\n3. TCM\n4. 0108244914\n5. kokfeng@gmail.com', ex],
        ['Bullets and emoji', '• Ngui Kok Feng\n- 831001105005\n👔 TCM\n📞 0108244914\n✉️ kokfeng@gmail.com', ex],
        ['Any order', '0108244914\nkokfeng@gmail.com\nNgui Kok Feng\n831001105005\nTCM', ex],
        ['One line, commas', 'Ngui Kok Feng, 831001105005, TCM, 0108244914, kokfeng@gmail.com', ex],
        ['One line, spaces', 'Ngui Kok Feng 831001105005 TCM 0108244914 kokfeng@gmail.com', ex],
        ['One line, slashes', 'Ngui Kok Feng / 831001105005 / TCM / 0108244914 / kokfeng@gmail.com', ex],
        ['a/l name keeps its slash', 'Raju a/l Muthu\n831001105005\nDriver\n0108244914', ['Raju a/l Muthu', '831001105005', 'Driver', '010-8244914', '']],
        ['+60 phone', 'Ngui Kok Feng\n831001105005\nTCM\n+60 10-824 4914', ['Ngui Kok Feng', '831001105005', 'TCM', '+60108244914', '']],
        ['011 number', 'Ngui Kok Feng\n831001105005\nTCM\n011-2345 6789', ['Ngui Kok Feng', '831001105005', 'TCM', '011-23456789', '']],
        ['Landline', 'Ngui Kok Feng\n831001105005\nTCM\n03-2345 6789', ['Ngui Kok Feng', '831001105005', 'TCM', '0323456789', '']],
        ['60 phone with no +, not an IC', 'Ngui Kok Feng\n601234567890\nTCM', ['Ngui Kok Feng', '', 'TCM', '601234567890', '']],
        ['No email', 'Ngui Kok Feng\n831001105005\nTCM\n0108244914', ['Ngui Kok Feng', '831001105005', 'TCM', '010-8244914', '']],
        ['No job', 'Ngui Kok Feng\n831001105005\n0108244914\nkokfeng@gmail.com', ['Ngui Kok Feng', '831001105005', '', '010-8244914', 'kokfeng@gmail.com'], ['name']],
        ['Name and phone only', 'Ngui Kok Feng\n0108244914', ['Ngui Kok Feng', '', '', '010-8244914', '']],
        ['Chinese name and job', '黄国峰\n831001105005\n中医师\n0108244914', ['黄国峰', '831001105005', '中医师', '010-8244914', '']],
        ['Both names on one line', 'Ngui Kok Feng 黄国峰\n831001105005\nTCM\n0108244914', ['Ngui Kok Feng 黄国峰', '831001105005', 'TCM', '010-8244914', '']],
        ['Appointment lines after', 'Ngui Kok Feng\n831001105005\nTCM\n0108244914\nkokfeng@gmail.com\nWednesday, 12 Nov 2pm\nMBB', ex],
        ['No job, appointment after', 'Ngui Kok Feng\n831001105005\n0108244914\n星期三 12 Nov\n2pm\nFar Coffee', ['Ngui Kok Feng', '831001105005', '', '010-8244914', '']],
        ['No job, tomorrow + venue', 'Ngui Kok Feng\n0108244914\nTomorrow\nFar Coffee Bukit Jalil', ['Ngui Kok Feng', '', '', '010-8244914', '']],
        ['No job, address line', 'Ngui Kok Feng\n0108244914\nJalan Ampang', ['Ngui Kok Feng', '', '', '010-8244914', '']],
        ['Name that is also a venue word', 'Monalisa Tan\n0108244914\nTeacher', ['Monalisa Tan', '', 'Teacher', '010-8244914', '']],
        ['Labels, no colons', 'Name Ngui Kok Feng\nIC 831001105005\nOccupation TCM\nPhone 0108244914\nEmail kokfeng@gmail.com', ex],
        ['Malay labels', 'Nama: Ngui Kok Feng\nNo. IC: 831001105005\nPekerjaan: TCM\nNo. Tel: 0108244914\nEmel: kokfeng@gmail.com', ex],
        ['Part labelled', 'Name: Ngui Kok Feng\n831001105005\nTCM\n0108244914', ['Ngui Kok Feng', '831001105005', 'TCM', '010-8244914', ''], ['occupation']],
        ['Labelled job above the name', 'Occupation: TCM\nNgui Kok Feng\n0108244914', ['Ngui Kok Feng', '', 'TCM', '010-8244914', ''], ['name']],
        ['Unknown label on phone', 'Ngui Kok Feng\n831001105005\nTCM\nHP: 010-8244914', ['Ngui Kok Feng', '831001105005', 'TCM', '010-8244914', '']],
        ['Unknown label with a value', 'Remark: VIP\nNgui Kok Feng\n0108244914', ['Ngui Kok Feng', '', '', '010-8244914', '']],
        ['Greeting first', 'Hi, here is my info\nNgui Kok Feng\n831001105005\nTCM\n0108244914', ['Ngui Kok Feng', '831001105005', 'TCM', '010-8244914', '']],
        ['Chinese greeting first', '你好，这是我的资料\n黄国峰\n0108244914', ['黄国峰', '', '', '010-8244914', '']],
        ['Thanks at the end, no job', 'Ngui Kok Feng\n0108244914\nThank you, have a nice day', ['Ngui Kok Feng', '', '', '010-8244914', '']],
        ['Passport', 'John Smith\nA12345678\nEngineer\n0108244914', ['John Smith', 'A12345678', 'Engineer', '010-8244914', '']],
        ['A line with digits is never the name', 'Order 88\nNgui Kok Feng\n0108244914', ['Ngui Kok Feng', '', '', '010-8244914', '']],
        ['No name found, so no job guessed', 'Lot 5 Block A\n0108244914', ['', '', '', '010-8244914', ''], []],
        ['Link line skipped','Ngui Kok Feng\n0108244914\nhttps://maps.app.goo.gl/evV979LDVe8E4p4B6', ['Ngui Kok Feng', '', '', '010-8244914', '']],
        ["Today's template", '请填妥基本资料 Basic information\n1. 姓名 Name : TAN AH KAU\n2. 身分号码 IC: 900101-10-1234\n3. 职业 Occupation: Engineer\n4. 联络号码 Phone no: 012-3456789\n5. 邮箱 Email: sample@example.com', ['TAN AH KAU', '900101-10-1234', 'Engineer', '012-3456789', 'sample@example.com'], []],
        ['Template, job left blank', '1. 姓名 Name : TAN AH KAU\n2. 身分号码 IC: 900101-10-1234\n3. 职业 Occupation:\n4. 联络号码 Phone no: 012-3456789\n5. 邮箱 Email: sample@example.com', ['TAN AH KAU', '900101-10-1234', '', '012-3456789', 'sample@example.com'], []],
        ['Template, name left blank', '1. 姓名 Name :\n2. 身分号码 IC: 900101-10-1234\n3. 职业 Occupation: Engineer', ['', '900101-10-1234', 'Engineer', '', ''], []],
        ['Template, values on the next line', '姓名 Name:\nNgui Kok Feng\n身分号码 IC:\n831001105005\n职业 Occupation:\nTCM', ['Ngui Kok Feng', '831001105005', 'TCM', '', '']],
        ['Plain sentence', 'Hi I would like to come for the talk next week please', ['', '', '', '', ''], []],
        ['Words only, no IC / phone / email', 'Ngui Kok Feng\nTCM', ['', '', '', '', ''], []],
        ['Two-line name (known limit)', '黄国峰\nNgui Kok Feng\n831001105005\nTCM\n0108244914', ['黄国峰', '831001105005', 'Ngui Kok Feng', '010-8244914', '']],
        ['Job before name (known limit)', 'TCM\nNgui Kok Feng\n831001105005\n0108244914', ['TCM', '831001105005', 'Ngui Kok Feng', '010-8244914', '']],
    ];
    for (const [label, text, want, wantGuessed] of CASES) {
        const { got, guessed } = read5(text);
        eq(label, got, want);
        if (wantGuessed) eq(label + ' (guessed)', guessed, wantGuessed);
    }

    // The appointment-line test: date, time, whole-line venue; never a name.
    for (const [line, want] of [
        ['12 Nov', true], ['2pm', true], ['下午3点', true], ['MBB', true], ['Far Coffee', true],
        ['far coffee  bukit jalil', true], ['Monalisa Tan', false], ['Lim Siew May', false],
        ['Ngui Kok Feng', false], ['TCM', false], ['Bangkok Bank officer', false],
    ]) eq(`isApptLine ${JSON.stringify(line)}`, isAppt(line), want);
    VENUES = null; // a failed venue read must not break the guess
    eq('isApptLine with no venues', (await pasteApptLineTest())('MBB'), false);

    // The May/Jun date fix: a name's month word never pairs with the next line
    // or a phone; real dates read as before.
    const today = new Date(2026, 10, 2);
    for (const [text, want] of [
        ['1. 姓名 Name : Lim Siew May\n2. 身分号码 IC: 900101-10-1234', ''],
        ['Lim Siew May\n031001105005\nTCM', ''],
        ['Wong Mei Jun\n0108244914', ''],
        ['Lim Siew May 0108244914', ''],
        ['Room 12\nMay Lim\n0108244914', ''],
        ['Wednesday, 21 Oct 2pm', '2026-10-21'],
        ['21 October 2026', '2026-10-21'],
        ['Nov 12, 2026', '2026-11-12'],
        ['12th Nov', '2026-11-12'],
        ['Lim Siew May\n12 Nov 2pm', '2026-11-12'],
        ['10月21日', '2026-10-21'],
        ['21/10/2026', '2026-10-21'],
    ]) eq(`date ${JSON.stringify(text)}`, parseApptDate(text, today), want);

    // ── The form side: a guess fills empty boxes only and is marked ─────────
    const mkEl = (id, value = '') => {
        const el = {
            id, value, nextElementSibling: null, listeners: {},
            insertAdjacentElement(_, node) { node.parent = el; el.nextElementSibling = node; },
            addEventListener(ev, fn) { el.listeners[ev] = fn; },
        };
        return el;
    };
    let els = {}, toasts = [], hidden = 0;
    const document = {
        getElementById: (id) => els[id] || null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => {
            const n = { style: {}, className: '', textContent: '' };
            n.classList = { contains: (k) => n.className.split(' ').includes(k) };
            n.remove = () => { if (n.parent) n.parent.nextElementSibling = null; };
            return n;
        },
    };
    const UI = { toast: { success: (m) => toasts.push(['ok', m]), error: (m) => toasts.push(['err', m]) } };
    const app = { pasteApptLineTest };
    VENUES = [];
    const _readCpsField = eval('(' + c('_readCpsField') + ')');
    const _writeCpsField = eval('(' + c('_writeCpsField') + ')');
    const _hideCpsScanOverlay = () => { hidden++; };
    const _markPasteGuess = eval('(' + c('_markPasteGuess') + ')');
    const parseCpsPastedText = eval('(' + c('parseCpsPastedText') + ')');
    const form = (paste, values = {}) => {
        els = { 'cps-paste-input': mkEl('cps-paste-input', paste) };
        for (const k of ['name', 'ic', 'occupation', 'phone', 'email', 'dob', 'gender', 'nationality']) els[`cps-${k}`] = mkEl(`cps-${k}`, values[k] || '');
        toasts = []; hidden = 0;
    };
    const note = (k) => (els[`cps-${k}`].nextElementSibling || {}).textContent || '';

    form('Ngui Kok Feng \n831001105005\nTCM\n0108244914\nkokfeng@gmail.com');
    await parseCpsPastedText('cps');
    eq('form: owner example values', ['name', 'ic', 'occupation', 'phone', 'email', 'dob', 'gender', 'nationality'].map(k => els[`cps-${k}`].value),
        ['Ngui Kok Feng', '831001105005', 'TCM', '010-8244914', 'kokfeng@gmail.com', '1983-10-01', 'Male', 'Malaysian']);
    eq('form: guessed boxes are marked', [note('name'), note('occupation'), note('ic')], ['Guessed from the paste, please check', 'Guessed from the paste, please check', '']);
    eq('form: toast asks to check', toasts, [['ok', 'Auto-filled 5 fields (+2 derived from IC). Please check Name and Occupation.']]);
    eq('form: overlay closed', hidden, 1);
    els['cps-name'].listeners.input();
    eq('form: editing the box removes its mark', note('name'), '');

    form('Ngui Kok Feng\n831001105005\nTCM\n0108244914', { name: 'Ngui Kok Feng (Kelvin)', occupation: 'Doctor' });
    await parseCpsPastedText('cps');
    eq('form: a guess never replaces a filled box', [els['cps-name'].value, els['cps-occupation'].value, els['cps-phone'].value], ['Ngui Kok Feng (Kelvin)', 'Doctor', '010-8244914']);
    eq('form: no mark on a box it left alone', [note('name'), note('occupation')], ['', '']);
    eq('form: toast without a check note', toasts, [['ok', 'Auto-filled 2 fields (+2 derived from IC).']]);

    form('Name: Tan Ah Kau\nOccupation: Engineer\nPhone: 0123456789', { name: 'Old', occupation: 'Old job' });
    await parseCpsPastedText('cps');
    eq('form: labelled values still replace, unmarked', [els['cps-name'].value, els['cps-occupation'].value, note('name')], ['Tan Ah Kau', 'Engineer', '']);

    form('Name: Tan Ah Kau\nPhone: 0123456789', { name: 'Ngui Kok Feng' });
    els['cps-name'].nextElementSibling = { className: 'paste-guess-note', classList: { contains: (k) => k === 'paste-guess-note' }, remove() { els['cps-name'].nextElementSibling = null; }, textContent: 'old' };
    await parseCpsPastedText('cps');
    eq('form: a second paste clears the old mark', note('name'), '');

    form('Hi I would like to come for the talk next week please');
    await parseCpsPastedText('cps');
    eq('form: plain sentence still errors and stays open', [toasts, hidden, els['cps-name'].value], [[['err', 'No recognizable fields found — please check the pasted text and try again.']], 0, '']);

    console.log(`test-paste-guess: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
