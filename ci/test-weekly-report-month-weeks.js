// ci/test-weekly-report-month-weeks.js — weekly report weeks never cross a month.
//
// WHY: owner 2026-11-02 — "W4 October" covered Mon 26 Oct – Sun 1 Nov, so 1 Nov was
// counted in October. A week now stops at the month's end; the new month's days go
// to its own weeks. A first or last piece under 4 days joins the week beside it, so
// no report is a 1-day stub and none runs 13 days (Dec 2026 would have: 1–13 Dec).
//
// HARNESS: loads the REAL chunks/script-reporting.js into a stubbed browser
// (same pattern as test-report-real-dates.js).
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++;
    console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
};

global.window = global;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.document = {
    getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, addEventListener: () => {},
    createElement: () => ({ style: {}, appendChild() {}, setAttribute() {}, click() {} }),
    body: { appendChild() {}, removeChild() {} },
};
global.location = { search: '' };
global.UI = { toast: { success() {}, error() {}, warning() {}, info() {} }, showModal: () => {}, hideModal: () => {}, formatDate: (d) => String(d || ''), currencyForCountry: () => 'MYR' };
global.app = { register: (_n, obj) => Object.assign(global.app, obj) };
global.window._appState = { cu: { id: 1, full_name: 'Boss', role: 'Level 1 Super Admin' }, cv: null };
global.window._crmUtils = {
    isSystemAdmin: () => true, isMarketingManager: () => false, isAgent: () => true,
    isManagement: () => true, isTeamLeaderOrAbove: () => true, isStockTakeStaff: () => false,
    escapeHtml: (s) => String(s ?? ''), isMobile: () => false, withTimeout: (p) => p, timeAgo: () => '', generateId: () => 1,
    USER_ROLES: ['Level 3 Agent'], ALL_COUNTRIES: '__ALL__', listCountryScope: () => '__ALL__', recordCountry: () => 'MY',
    getVisibleUserIds: async () => 'all',
};
global.AppDataStore = { getAll: async () => [], getActivitiesInRange: async () => [], getById: async () => null, query: async () => [] };

const chunkPath = path.join(__dirname, '..', 'chunks', 'script-reporting.js');
let src = fs.readFileSync(chunkPath, 'utf8');
const ANCHOR = "app.register('reporting', {";
if (!src.includes(ANCHOR)) { console.error('FAIL: register anchor not found'); process.exit(1); }
src = src.replace(ANCHOR, `window.__T = { _wrMonthWeeks, _wrWeekOf, _wrLastFinishedWeek, _wrLabelFor };
    ${ANCHOR}`);
try { (0, eval)(src); } catch (e) { console.error('FAIL loading chunk: ' + e.message); process.exit(1); }

const T = window.__T;
const pad = (n) => String(n).padStart(2, '0');
const ds = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const span = (w) => `${w.from}..${w.to}`;

// ── Every month 2025–2028: the weeks tile the month exactly ──
let bad = [];
for (let y = 2025; y <= 2028; y++) {
    for (let m = 0; m < 12; m++) {
        const weeks = T._wrMonthWeeks(y, m);
        const last = new Date(y, m + 1, 0).getDate();
        let next = 1;
        weeks.forEach((w, i) => {
            const a = new Date(w.from + 'T00:00:00'), b = new Date(w.to + 'T00:00:00');
            const days = Math.round((b - a) / 86400000) + 1;
            const where = `${ds(y, m, 1).slice(0, 7)} ${w.label}`;
            if (w.from !== ds(y, m, next)) bad.push(`${where}: gap/overlap at ${w.from}`);
            if (a.getMonth() !== m || b.getMonth() !== m) bad.push(`${where}: crosses a month`);
            if (days < 4 || days > 10) bad.push(`${where}: ${days} days`);
            if (a.getDate() !== 1 && a.getDay() !== 1) bad.push(`${where}: starts mid-week`);
            if (b.getDate() !== last && b.getDay() !== 0) bad.push(`${where}: ends mid-week`);
            if (!w.label.startsWith(`W${i + 1} `) || !w.label.endsWith(` ${y}`)) bad.push(`${where}: label`);
            next = b.getDate() + 1;
        });
        if (next !== last + 1) bad.push(`${ds(y, m, 1)}: month not fully covered`);
    }
}
eq('48 months: every day in exactly one 4–10 day week inside its month', bad, []);

// ── The owner's months ──
const spans = (y, m) => T._wrMonthWeeks(y, m).map(w => `${w.label}: ${span(w)}`);
eq('Oct 2026', spans(2026, 9), [
    'W1 October 2026: 2026-10-01..2026-10-04', 'W2 October 2026: 2026-10-05..2026-10-11',
    'W3 October 2026: 2026-10-12..2026-10-18', 'W4 October 2026: 2026-10-19..2026-10-25',
    'W5 October 2026: 2026-10-26..2026-10-31']);
eq('Nov 2026: 1 Nov (Sunday) joins W1; 30 Nov (Monday) joins W4', spans(2026, 10), [
    'W1 November 2026: 2026-11-01..2026-11-08', 'W2 November 2026: 2026-11-09..2026-11-15',
    'W3 November 2026: 2026-11-16..2026-11-22', 'W4 November 2026: 2026-11-23..2026-11-30']);
eq('Dec 2026: 1–6 Dec is its own W1 (no 13-day week)', spans(2026, 11), [
    'W1 December 2026: 2026-12-01..2026-12-06', 'W2 December 2026: 2026-12-07..2026-12-13',
    'W3 December 2026: 2026-12-14..2026-12-20', 'W4 December 2026: 2026-12-21..2026-12-27',
    'W5 December 2026: 2026-12-28..2026-12-31']);
eq('Jan 2027: 1–3 Jan join W1', spans(2027, 0)[0], 'W1 January 2027: 2027-01-01..2027-01-10');
eq('Feb 2027 (starts Monday, ends Sunday): four plain weeks', spans(2027, 1).length, 4);
eq('month -1 rolls back a year', span(T._wrMonthWeeks(2027, -1)[0]), '2026-12-01..2026-12-06');

// ── Which week the report opens on ──
const opens = (y, m, d) => { const w = T._wrLastFinishedWeek(new Date(y, m, d)); return `${w.label}: ${span(w)}`; };
eq('Mon 2 Nov 2026 opens on October\'s last week, without 1 Nov', opens(2026, 10, 2), 'W5 October 2026: 2026-10-26..2026-10-31');
eq('Sun 1 Nov 2026: October ended yesterday', opens(2026, 10, 1), 'W5 October 2026: 2026-10-26..2026-10-31');
eq('Sat 31 Oct 2026: the last week is still running', opens(2026, 9, 31), 'W4 October 2026: 2026-10-19..2026-10-25');
eq('Mon 9 Nov 2026 opens on W1 with 1 Nov', opens(2026, 10, 9), 'W1 November 2026: 2026-11-01..2026-11-08');
eq('Mon 30 Nov 2026: W4 runs to today, so W3', opens(2026, 10, 30), 'W3 November 2026: 2026-11-16..2026-11-22');
eq('Tue 1 Dec 2026: W4 November is ready', opens(2026, 11, 1), 'W4 November 2026: 2026-11-23..2026-11-30');
eq('Mon 7 Dec 2026', opens(2026, 11, 7), 'W1 December 2026: 2026-12-01..2026-12-06');
eq('Mon 4 Jan 2027 reaches back into December', opens(2027, 0, 4), 'W5 December 2026: 2026-12-28..2026-12-31');

// ── Week of a date ──
eq('1 Nov 2026 belongs to W1 November', T._wrWeekOf(new Date(2026, 10, 1)).label, 'W1 November 2026');
eq('31 Oct 2026 belongs to W5 October', T._wrWeekOf(new Date(2026, 9, 31)).label, 'W5 October 2026');

// ── Label follows the dates ──
eq('label: report week', T._wrLabelFor('2026-10-26', '2026-10-31'), 'W5 October 2026');
eq('label: W1 with the 1st', T._wrLabelFor('2026-11-01', '2026-11-08'), 'W1 November 2026');
eq('label: a Mon–Sun that crosses months is plain dates', T._wrLabelFor('2026-10-26', '2026-11-01'), '26 Oct – 1 Nov 2026');
eq('label: Mon–Sun that is not a report week', T._wrLabelFor('2026-11-02', '2026-11-08'), '2 Nov – 8 Nov 2026');
eq('label: whole month', T._wrLabelFor('2026-11-01', '2026-11-30'), 'November 2026');
eq('label: one day', T._wrLabelFor('2026-11-03', '2026-11-03'), '3 Nov 2026');

console.log(`test-weekly-report-month-weeks: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
