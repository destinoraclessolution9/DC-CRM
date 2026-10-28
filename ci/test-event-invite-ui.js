// ci/test-event-invite-ui.js — ✨ Who to invite on the event screen (2026-10-28).
// Evaluates the REAL helper block of chunks/script-calendar.js (from the
// "✨ Who to invite" banner up to _invFill) in a vm sandbox and checks the
// WhatsApp text, phone normalisation, the purpose suggestion, and what each
// invite state shows. The engine itself is tested in SQL:
// ci/sql/event-invite-scenario.sql.
// Run: node ci/test-event-invite-ui.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(name, got, want = true) {
    if (got === want) { pass++; return; }
    fail++;
    console.error(`FAIL ${name}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`);
}

const src = fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-calendar.js'), 'utf8');
const a = src.indexOf('// ── ✨ Who to invite (event invite engine');
const b = src.indexOf('const _invFill = async');
const c = src.indexOf('// ── 🎯 Purpose picker');
const d = src.indexOf('const invOpenObjectives = async');
if (a < 0 || b < 0 || c < 0 || d < 0) { console.error('FAIL could not find the invite helper block'); process.exit(1); }
const block = src.slice(a, b) + '\n' + src.slice(c, d);

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const sandbox = { esc: escapeHtml, escapeHtml, _state: { cu: { id: 7, full_name: 'Agent Seven' } }, window: {}, console, Date };
vm.createContext(sandbox);
vm.runInContext(block + `
;globalThis.T = { _invMessage, _invWaPhone, _invSuggest, _invHead, _invHtml, _invRowHtml, _invActionsHtml, _INV_DECLINE, _INV_REMOVE };`, sandbox);
const T = sandbox.T;

// ── WhatsApp text ─────────────────────────────────────────────────────────
const ev = { session_date: '2026-10-31', start_time: '13:15:00', venue: 'DC HQ', event_title: '天心交喜',
    message: 'Hi {name}，诚邀您出席《{event}》！日期：{date}（{weekday}）{time}，地点：{venue}。期待与您相见！— {agent}' };
const m1 = T._invMessage(ev, { name: 'Yuki' }, 'Mei Lin');
check('message fills every field', m1, 'Hi Yuki，诚邀您出席《天心交喜》！日期：10月31日（星期六）13:15，地点：DC HQ。期待与您相见！— Mei Lin');
const m2 = T._invMessage({ ...ev, venue: null, start_time: null }, { name: 'Yuki' }, 'Mei Lin');
check('no venue → venue part dropped', m2.includes('地点'), false);
check('no time → no stray placeholder', m2.includes('{time}'), false);
check('no venue / time keeps the date', m2.includes('10月31日（星期六）'), true);

// ── phone ─────────────────────────────────────────────────────────────────
check('MY mobile 012…', T._invWaPhone('012-217 7607'), '60122177607');
check('already 60…', T._invWaPhone('+60 12 217 7607'), '60122177607');
check('Singapore 65 + 8 digits kept', T._invWaPhone('+65 9123 4567'), '6591234567');
check('empty phone', T._invWaPhone(''), '');

// ── purpose suggestion from the title ─────────────────────────────────────
const lines = [
    { key: 'fengshui', subcategories: ['Huan Tian Xin', 'Fengshui Audit · 灵活 Flexi'], keywords: ['风水', '天心'], event_keywords: ['汇集', '风水', '天心'] },
    { key: 'ring', subcategories: ['Power Ring'], keywords: ['指环'], event_keywords: ['个人改命'] },
    { key: 'business', subcategories: ['Recruitment'], keywords: ['招商'], event_keywords: ['招商'] },
    { key: 'general', subcategories: [], keywords: [], event_keywords: [] },
];
const products = [
    { id: 11, name: '换天心 Huan Tian Xin', subcategory: 'Huan Tian Xin' },
    { id: 12, name: '灵活风水-公寓 Flexi Fengshui Condominium', subcategory: 'Fengshui Audit · 灵活 Flexi' },
    { id: 13, name: '一星指环 Power Ring One', subcategory: 'Power Ring' },
    { id: 14, name: 'DC 代理配套', subcategory: 'Recruitment' },
];
const s1 = T._invSuggest('天心交喜 老板每月主题课', lines, products);
check('天心交喜 → 风水 decide + upgrade', s1.map(o => o.line + ':' + o.goal).join(','), 'fengshui:decide,fengshui:upgrade');
check('天心交喜 → focus 换天心', JSON.stringify(s1[0].focus), '[11]');
const s2 = T._invSuggest('DC 招商会', lines, products);
check('招商会 → business decide', s2.map(o => o.line + ':' + o.goal).join(','), 'business:decide');
check('"DC" alone never names a product', JSON.stringify(s2[0].focus), '[]');
const s3 = T._invSuggest('福气分享会', lines, products);
check('nothing matched → general introduce', s3.map(o => o.line + ':' + o.goal).join(','), 'general:introduce');
check('product head 换天心', T._invHead('换天心 Huan Tian Xin'), '换天心');
check('product head strips the number', T._invHead('天至喜1 Tian Zhi Xi 1'), '天至喜');

// ── what each state shows ─────────────────────────────────────────────────
const base = { id: 5, name: 'Yuki', is_customer: false, prospect_id: 9, grp: 'strong', fit: 90, engagement: 40, readiness: 0,
    reasons: [{ t: 'Came to 汇集-专案', d: '2026-09-27', ref: 'act', id: 77 }, { t: 'Discussed 专案', d: '2026-09-27', ref: 'act', id: 78 }, { t: 'third', d: '2026-01-01' }],
    warnings: ['only_events'], state: 'suggested', phone: '0122177607' };
const act = (row, past = false) => T._invActionsHtml(1, row, past);
check('suggested → WhatsApp', act(base).includes('invWhatsApp'), true);
check('suggested → Sent ✓', act(base).includes("'sent'"), true);
check('prefers call → Call, no WhatsApp', act({ ...base, prefers_call: true }).includes('tel:0122177607') && !act({ ...base, prefers_call: true }).includes('invWhatsApp'), true);
check('no phone → no WhatsApp button', act({ ...base, phone: '' }).includes('invWhatsApp'), false);
check('sent → Coming / Not coming', act({ ...base, state: 'sent', sent_at: '2026-10-28T01:00:00Z' }).includes("'coming'") && act({ ...base, state: 'sent' }).includes("'decline'"), true);
check('declined → reason + Undo', act({ ...base, state: 'sent', reply: 'declined', decline_reason: 'no_time' }).includes('没时间') && act({ ...base, reply: 'declined', decline_reason: 'no_time' }).includes("'undo'"), true);
check('coming → registered', act({ ...base, reply: 'coming' }).includes('Coming ✓'), true);
check('came → Came ✓', act({ ...base, reply: 'coming', attended: true }).includes('Came ✓'), true);
check('past + never sent → Not invited, no buttons', act(base, true).includes('Not invited') && !act(base, true).includes('<button'), true);
check('held back by the engine → no Undo', act({ ...base, state: 'removed', removed_reason: 'excluded' }).includes("'undo'"), false);
check('not suitable → Undo', act({ ...base, state: 'removed', removed_reason: 'not_fit' }).includes("'undo'"), true);
const rowHtml = T._invRowHtml(1, base, false);
check('row shows only the top 2 reasons', rowHtml.includes('third'), false);
check('row shows the data warning', rowHtml.includes('Only event attendance recorded'), true);
check('reason links to the record', rowHtml.includes('app.viewActivityDetails(77)'), true);
check('name is escaped', T._invRowHtml(1, { ...base, name: '<img src=x onerror=alert(1)>' }, false).includes('<img'), false);
check('decline reasons include "stop inviting me"', T._INV_DECLINE.some(r => r[0] === 'stop'), true);

// ── the whole section ─────────────────────────────────────────────────────
const noPurpose = { objectives: [], can_set: true, past: false, slots: 9, rows: [], agents: [] };
check('no purpose → asks what the event is for', T._invHtml(1, noPurpose).includes('What is this event for?'), true);
check('no purpose + past → nothing', T._invHtml(1, { ...noPurpose, past: true }), '');
check('no purpose + cannot set → nothing', T._invHtml(1, { ...noPurpose, can_set: false }), '');
const full = {
    objectives: [{ line: 'fengshui', goal: 'upgrade', line_label: '风水 Fengshui', focus_names: ['换天心 Huan Tian Xin'] }],
    can_set: true, past: false, slots: 9, me: 7,
    rows: [{ ...base, mine: true, agent_name: 'Agent Seven' }, { ...base, id: 6, name: 'Other person', mine: false, agent_name: 'Agent Two' }],
    agents: [{ agent_id: 7, agent_name: 'Agent Seven', suggested: 1, sent: 0, replied: 0, coming: 0, came: 0 },
             { agent_id: 2, agent_name: 'Agent Two', suggested: 1, sent: 1, replied: 1, coming: 1, came: 0 }],
    summary: { excluded: { registered: 2, do_not_invite: 1 } },
};
const fullHtml = T._invHtml(1, full);
check('purpose chip shows line · goal · focus', fullHtml.includes('风水 Fengshui · Upgrade 升级 · 换天心'), true);
check('"Your 1 to invite"', fullHtml.includes('Your 1 to invite'), true);
check('team rows grouped under the agent', fullHtml.includes('<details class="inv-agent">') && fullHtml.includes('Agent Two'), true);
check('funnel totals', fullHtml.includes('<b>2</b> suggested') && fullHtml.includes('<b>1</b> coming'), true);
check('held-back counts', fullHtml.includes('2 already registered') && fullHtml.includes('1 do not invite'), true);
check('add-person box on an upcoming event', fullHtml.includes('inv-add-q-1'), true);
check('no add-person box after the event', T._invHtml(1, { ...full, past: true }).includes('inv-add-q-1'), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
