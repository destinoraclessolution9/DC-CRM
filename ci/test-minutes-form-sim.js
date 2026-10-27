// ci/test-minutes-form-sim.js — the 2026-10-26 Post-Meetup Notes form
// (chunks/script-activities.js buildPostMeetupNotesBlock + collectors).
// Loads the REAL chunk in a vm sandbox and checks: the four steps, result /
// grade chips writing hidden inputs, products as priced hidden checkboxes
// (stored text format unchanged), next-step rows from the list / the old
// single next action / nothing, event picker, read-only preview, escaping,
// and the collectors (steps + summary fields, follow-ups, people).
// Run: node ci/test-minutes-form-sim.js
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

// ─── DOM stub: ids + the step / person rows the collectors walk ─────────────
const byId = new Map();
let rows = [], people = [], oppBoxes = [];
const el = (id, props = {}) => { const e = { id, value: '', checked: false, dataset: {}, style: {}, innerHTML: '', ...props }; if (id) byId.set(id, e); return e; };
const field = (v, extra = {}) => ({ value: v, checked: false, selectedOptions: [], ...extra });
const fakeRow = (o) => ({
  querySelector(sel) {
    const map = {
      '.pmf-step-type': field(o.type), '.pmf-step-due': field(o.due || ''), '.pmf-step-text': field(o.text || ''),
      '.pmf-step-event': field(o.event || '', { selectedOptions: [{ dataset: { event: String(o.eventId || '') }, textContent: o.eventTitle || '' }] }),
      '.pmf-step-bookcb': field('', { checked: !!o.book }),
      '.pmf-person-name': field(o.name || ''), '.pmf-person-rel': field(o.rel || ''), '.pmf-person-phone': field(o.phone || ''),
      '.pmf-person-voucher': field('', { checked: o.voucher !== false }),
    };
    return map[sel] || null;
  },
});
const document = {
  getElementById: (id) => byId.get(id) || null,
  createElement: () => el(null),
  body: el('__body__'),
  addEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: (sel) => {
    if (/-steplist \.pmf-step$/.test(sel)) return rows;
    if (/-people \.pmf-person$/.test(sel)) return people;
    if (/^input\[name="pmn-opp-items"\]:checked$/.test(sel)) return [{ value: 'Power Ring PR3', dataset: { group: 'Products' } }];
    if (/^input\[name="pmn-opp-items"\]$/.test(sel)) return oppBoxes;
    return [];
  },
};

const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const _crmUtils = new Proxy({ escapeHtml, isMobile: () => false, debounce: (f) => f, debounceCall: (f) => f, getUserLevel: () => 1, cuHomeCountry: () => 'MY', USER_ROLES: [] },
  { get: (t, k) => (k in t ? t[k] : () => undefined) });
const UI = new Proxy({ showModal() {}, hideModal() {}, toast: { success() {}, error() {}, info() {} }, escJsAttr: (s) => String(s ?? '').replace(/'/g, "\\'"), money: (v) => `RM ${v}` },
  { get: (t, k) => (k in t ? t[k] : () => '') });
const appStub = {
  register(name, fns) { Object.assign(this, fns); },
  // calendar chunk's parser / serializer (the real ones live there)
  parseSelectedItems: (t) => {
    if (!t) return { selected: [], remarks: '' };
    const m = t.match(/\|\s*Remarks:\s*([\s\S]*)/);
    const items = m ? t.slice(0, m.index) : t;
    const selected = [];
    const re = /\[([^\]]+)\]\s*([^[|]*)/g; let x;
    while ((x = re.exec(items)) !== null) selected.push(...x[2].split(',').map(s => s.trim()).filter(Boolean));
    return { selected, remarks: m ? m[1].trim() : '' };
  },
  serializeMultiSelectToText: () => '[Products] Power Ring PR3',
  buildRelationOptions: () => '<option value="Friend">Friend</option>',
};
const windowStub = { _appState: { cu: { id: 1, role: 'Level 1' } }, _crmUtils, app: appStub, _loadChunk: async () => {}, addEventListener: () => {}, location: { hostname: 'localhost' } };
const sandbox = {
  window: windowStub, document, AppDataStore: {}, UI, app: appStub, console,
  CSS: { escape: (v) => String(v).replace(/["\\]/g, '\\$&') },
  setTimeout: () => 0, clearTimeout: () => {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'node-sim' }, URL, Blob: function () {}, FileReader: function () {}, FormData: function () {},
  fetch: async () => ({ ok: false, json: async () => ({}) }),
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-activities.js'), 'utf8'), sandbox, { filename: 'script-activities.js' });
// the real minutes parser + points formatter (window._dataHelpers)
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'data-helpers.js'), 'utf8'), sandbox, { filename: 'data-helpers.js' });
const app = windowStub.app;

const OPTS = {
  products: [{ name: 'Power Ring PR3', price: 18990 }, { name: '个人风水基础课', price: 380 }],
  bujishu: [{ name: '旺床 King', price: 6800 }], formula: [], events: [{ categories: '["福气分享会"]' }],
  gradeContext: { current: 'C' }, allowNoStep: true, withPeople: true,
  upcomingEvents: [{ id: 701, event_id: 91, activity_title: '九星课 <b>Nov</b>', activity_date: '2026-11-04' }],
};

// ── builder: full form ─────────────────────────────────────────────────────
{
  const html = app.buildPostMeetupNotesBlock('pmn', {
    activity_date: '2026-10-25', outcome: 'positive', opportunity_potential: '[Products] Power Ring PR3 | Remarks: maybe a sofa',
    next_actions: [{ text: 'Follow up <img src=x>', type: 'call', due: '2026-11-01' }, { text: 'Invite', type: 'event', due: '2026-11-03', event_activity_id: 701 }],
    meeting_minutes: { reaction: 'Keen' }, note_pain_points: 'Price',
  }, OPTS);
  check('no step button bar', !html.includes('pmf-steps') && !html.includes('data-step='));
  check('no microphone buttons', !html.includes('openVoiceRecorder') && !html.includes('fa-microphone'));
  check('People opens itself ready to fill', html.includes(`id="pmn-step-4" ontoggle="app.pmfFoldOpened(this, 'pmn')"`));
  check('result chips + required mark', html.includes('How did today go?') && html.includes('required') && (html.match(/data-group="outcome"/g) || []).length === 1);
  check('saved result in the hidden input + chip on', html.includes('id="pmn-outcome-type" value="positive"') && /pmf-chip is-on" data-v="positive"/.test(html));
  check('grade chips A-F, current C on', ['A', 'B', 'C', 'D', 'F'].every(g => html.includes(`data-v="${g}"`)) && /pmf-chip is-on" data-v="C"/.test(html));
  check('grade hidden input keeps the current grade', html.includes('id="pmn-grade" value="C" data-current="C"'));
  check('products are priced hidden checkboxes', html.includes('value="Power Ring PR3" data-group="Products" data-price="18990"') && html.includes('data-price="6800"'));
  check('saved product ticked', /value="Power Ring PR3" data-group="Products" data-price="18990"\s+checked/.test(html));
  check('remarks kept in the "not in the list" box', html.includes('maybe a sofa'));
  check('two saved steps as rows', (html.match(/class="pmf-step"/g) || []).length, 2);
  check('step text escaped', html.includes('Follow up &lt;img src=x&gt;') && !html.includes('<img src=x>'));
  check('event row picks its session', /<option value="701" data-event="91" selected>/.test(html));
  check('event title escaped', html.includes('九星课 &lt;b&gt;Nov&lt;/b&gt;'));
  check('no-step reason chips', html.includes('data-v="later"') && html.includes('data-v="not_interested"'));
  check('notes open when there are notes', /id="pmn-step-3" open/.test(html));
  check('people step present', html.includes('id="pmn-step-4"') && html.includes('People they recommended'));
  check('ChatGPT paste kept', html.includes('id="pmn-minutes-paste"'));
  check('old event-checkbox list gone', !html.includes('pmn-na-items') && !html.includes('next-action-remarks'));
  check('class waiting option group', html.includes('Not on the calendar yet') && html.includes('value="cat:个人风水基础课"'));
  check('classes in use by topics are offered', html.includes('value="cat:福气分享会"'));
}
// ── builder: old single next action → one row; nothing → one empty row ─────
{
  const html = app.buildPostMeetupNotesBlock('pmn', { activity_date: '2026-10-25', next_action: '九星课, 改命会 | Remarks: call his wife' }, OPTS);
  check('legacy next action → one row in words', (html.match(/class="pmf-step"/g) || []).length === 1 && html.includes('value="九星课, 改命会 — call his wife"'));
  const empty = app.buildPostMeetupNotesBlock('pmn', { activity_date: '2026-10-25' }, { ...OPTS, gradeContext: null, allowNoStep: false, withPeople: false, noOutcome: true });
  check('fresh form starts with one empty call row', (empty.match(/class="pmf-step" data-type="call"/g) || []).length, 1);
  check('attendee form: no result chips, no grade, no people', !empty.includes('How did today go?') && !empty.includes('How hot') && !empty.includes('pmn-step-4'));
  check('notes fold scrolls into view when opened', empty.includes(`id="pmn-step-3" ontoggle="app.pmfFoldOpened(this, 'pmn')"`));
}
// ── read-only preview ──────────────────────────────────────────────────────
{
  const html = app.buildPostMeetupNotesBlock('preview', { activity_date: '2026-10-25' }, OPTS);
  check('preview: no paste box, no add buttons', !html.includes('preview-minutes-paste') && !html.includes('Add next step'));
  check('preview: inputs disabled', /pmf-step-text"[^>]*disabled/.test(html));
}
// ── collectors ─────────────────────────────────────────────────────────────
{
  el('pmn-steplist'); el('pmn-key-points', { value: 'kp' }); el('pmn-outcome-type', { value: 'neutral' });
  el('pmn-needs', { value: '' }); el('pmn-pain-points', { value: 'p' }); el('pmn-no-step', { value: 'later' });
  el('pmn-apu-after', { checked: true });
  rows = [
    fakeRow({ type: 'call', text: 'Call him', due: '2026-11-01' }),
    fakeRow({ type: 'event', text: 'Invite to 九星课', due: '2026-11-03', event: '701', eventId: 91 }),
    fakeRow({ type: 'meetup', text: 'Meet wife', due: '2026-11-05', book: true }),
    fakeRow({ type: 'other', text: '   ', due: '2026-11-06' }),
    fakeRow({ type: 'event', text: 'Waiting for 个人风水基础课', due: '2026-11-07', event: 'cat:个人风水基础课' }),
  ];
  people = [fakeRow({ name: 'Tan Ah Kow', rel: 'Friend', phone: '0123', voucher: true }), fakeRow({ name: '', rel: 'Friend' }), fakeRow({ name: 'Lee', rel: '', voucher: false })];
  const d = app.collectPostMeetupNotesData('pmn');
  check('collect: four steps (blank row dropped)', d.next_actions.length, 4);
  check('collect: class wait has a category, no session', d.next_actions[3].event_category === '个人风水基础课' && !('event_activity_id' in d.next_actions[3]));
  check('collect: event step keeps its session', d.next_actions[1].event_activity_id === 701 && d.next_actions[1].event_id === 91);
  check('collect: booking flag never stored', d.next_actions.every(r => !('_book' in r)));
  check('collect: summary text for old screens', d.next_action, 'Call him; Invite to 九星课; Meet wife; Waiting for 个人风水基础课');
  check('collect: first step due', d.next_action_due, '2026-11-01');
  check('collect: result', d.outcome, 'neutral');
  const fu = app.collectMinutesFollowUps('pmn');
  check('follow-ups: booking flag kept for after save', fu.steps[2]._book === true);
  check('follow-ups: no-step reason + APU', fu.noStep === 'later' && fu.apuAfter === true);
  check('follow-ups: people (blank dropped, relation default)', JSON.stringify(fu.people.map(p => [p.full_name, p.relation, p.phone, p.voucher])),
    JSON.stringify([['Tan Ah Kow', 'Friend', '0123', true], ['Lee', 'Other', null, false]]));
  rows = [fakeRow({ type: 'call', text: '' })];
  check('collect: no steps → empty list, empty summary', JSON.stringify([app.collectPostMeetupNotesData('pmn').next_actions, app.collectPostMeetupNotesData('pmn').next_action]), JSON.stringify([[], '']));
  byId.delete('pmn-steplist');
  check('collect: old form without the list leaves next steps alone', !('next_actions' in app.collectPostMeetupNotesData('pmn')));
}

// ── edited ChatGPT paste re-fills only its own fields; notes saved as points ──
{
  const html = app.buildPostMeetupNotesBlock('pmn', { activity_date: '2026-10-25', meeting_minutes: { raw: 'OLD PASTE', pasted: { keyPoints: '1. a\n2. b' } } }, OPTS);
  check('saved paste comes back for editing', html.includes('>OLD PASTE</textarea>') && html.includes('Edit the pasted ChatGPT minutes'));
  el('pmn-minutes-result');
  el('pmn-key-points', { value: '1. a\n2. b' });            // still what the last paste put there
  el('pmn-background', { value: 'typed by hand' });         // changed by the agent
  el('pmn-advisor', { value: '' });                         // empty
  el('pmn-reaction', { value: '积极' });                     // already equal to the paste
  el('pmn-minutes-paste', { value: [
    '1. 客户背景 (Customer Background)', '- 新背景', '2. 会面重点 (Meeting Key Points)', '- 想了解PR3', '- 太太决定布局',
    '3. 顾问观察与建议 (Advisor Observations & Suggestions)', '- 先做家居审计', '4. 客户反应与DC记录 (Customer Reaction & DC Records)', '- 积极',
  ].join('\n') });
  app.applyPastedMinutes('pmn');
  check('refill: pasted field follows the edited paste, as points', byId.get('pmn-key-points').value, '1. 想了解PR3\n2. 太太决定布局');
  check('refill: hand-edited field is kept', byId.get('pmn-background').value, 'typed by hand');
  check('refill: hand-edited field is asked about', byId.get('pmn-minutes-result').innerHTML.includes('You changed this field'));
  check('refill: empty field filled', byId.get('pmn-advisor').value, '先做家居审计');
  check('refill: equal field untouched', byId.get('pmn-reaction').value, '积极');
  // saving: what the paste filled is remembered; hand-typed lines are numbered
  el('pmn-needs', { value: 'line one\nline two' });
  el('pmn-pain-points', { value: 'just one' });
  const d = app.collectPostMeetupNotesData('pmn');
  check('save: hand-typed lines numbered', d.note_needs, '1. line one\n2. line two');
  check('save: single line untouched', d.note_pain_points, 'just one');
  check('save: remembers what the paste filled', d.meeting_minutes.pasted.keyPoints === '1. 想了解PR3\n2. 太太决定布局' && d.meeting_minutes.pasted.advisor === '先做家居审计');
  check('save: hand-edited field not claimed by the paste', !('background' in d.meeting_minutes.pasted));
}
// ── Potential from minutes with no 潜在机会 section (Gredgory, 2026-10-26) ──
{
  const box = (v, price) => ({ value: v, checked: false, dataset: { group: 'Products', price: String(price) } });
  oppBoxes = [box('六曜指环 Support Power Ring', 18990), box('文昌指环 Wisdom Power Ring', 18990), box('五福指环 Five Star Power Ring', 18990), box('大满福 Da Man Fu', 3000)];
  ['pmn-minutes-result', 'pmn-opp-box', 'pmn-opp-chips', 'pmn-background', 'pmn-key-points', 'pmn-advisor', 'pmn-reaction'].forEach(id => el(id));
  el('pmn-opportunity-remarks', { value: '' });
  rows = [];
  el('pmn-minutes-paste', { value: [
    '客户会面纪要', '客户来源： 米香传福', '客户行业： 理发业',
    '客户背景', '客户主要从事理发行业，由米香介绍传福而来。',
    '会面重点', '客户个性较急。', '已向客户介绍 Powering 6 与 Powering 4 配套，报价为 RM21,990。',
    '顾问观察与建议', '客户未来仍有跟进机会。',
    '客户反应与 DC 相关记录', '客户曾传福三人：', 'Chen Siau Yee — 客户太太',
    '后续跟进', '跟进客户本人： 了解其对 RM21,990 的 Powering 6 与 Powering 4 配套的考虑进度。',
    '顾问备注： 目前对上次会面的部分细节记忆不完整。',
  ].join('\n') });
  app.applyPastedMinutes('pmn');
  const res = byId.get('pmn-minutes-result').innerHTML;
  check('no potential section: rings found from Powering 6 / 4', oppBoxes.filter(b => b.checked).map(b => b.value).join('|'), '六曜指环 Support Power Ring|文昌指环 Wisdom Power Ring');
  check('no potential section: flagged for checking', res.includes('Found in the notes — please check'));
  check('quoted RM line kept once in remarks', byId.get('pmn-opportunity-remarks').value, '已向客户介绍 Powering 6 与 Powering 4 配套，报价为 RM21,990。');
  check('chips show the two rings + total', /六曜指环[\s\S]*文昌指环[\s\S]*RM 37,980/.test(byId.get('pmn-opp-chips').innerHTML));
  check('source + industry kept in background', byId.get('pmn-background').value.startsWith('1. 客户来源：米香传福\n2. 客户行业：理发业'));
  check('"客户反应与 DC 相关记录" is the reaction section', byId.get('pmn-reaction').value.includes('Chen Siau Yee'));
  check('顾问备注 goes to advisor, not a next step', byId.get('pmn-advisor').value.includes('记忆不完整'));
  // a 潜在机会 section with a ring code ticks the ring, no leftover
  oppBoxes.forEach(b => { b.checked = false; });
  byId.get('pmn-opportunity-remarks').value = '';
  byId.get('pmn-minutes-paste').value = '6. 潜在机会与产品 (Potential & Opportunities)\n- PR5\n- 大满福';
  app.applyPastedMinutes('pmn');
  check('section: PR5 + 大满福 ticked', oppBoxes.filter(b => b.checked).map(b => b.value).join('|'), '五福指环 Five Star Power Ring|大满福 Da Man Fu');
  check('section: bare ring code not copied into remarks', byId.get('pmn-opportunity-remarks').value, '');
  oppBoxes = [];
}
// ── Quoted RM per product (2026-10-27) ─────────────────────────────────────
{
  const box = (v, price) => ({ value: v, checked: true, dataset: { group: 'Products', ...(price ? { price: String(price) } : {}) } });
  oppBoxes = [box('六曜指环 Support Power Ring', 18990), box('专案-排屋 Terrace House (Direct On)', 0)];
  // the form seeds saved quotes from the activity row
  app.buildPostMeetupNotesBlock('pmq', { activity_date: '2026-10-27', quoted_prices: { '六曜指环 Support Power Ring': 15000 } }, OPTS);
  el('pmq-opp-chips');
  const q = (sel) => sel;
  oppBoxes.forEach(b => b);
  document.querySelectorAll = ((orig) => (sel) => (/^input\[name="pmq-opp-items"\]/.test(sel) ? oppBoxes : orig(sel)))(document.querySelectorAll);
  app.pmfRenderProducts('pmq');
  const h1 = byId.get('pmq-opp-chips').innerHTML;
  check('quote: one row per product with a Quoted RM box', (h1.match(/class="pmf-prow/g) || []).length === 2 && h1.includes('Quoted RM'));
  check('quote: saved quote shown, list price kept as reference', h1.includes('value="15000"') && h1.includes('list RM 18,990'));
  check('quote: a plan with no list price asks for one', /pmf-prow need[\s\S]*专案-排屋/.test(h1) && h1.includes('1 need a quoted RM'));
  check('quote: total uses the quote', h1.includes('RM 15,000'));
  el('pmq-opp-total');
  app.pmfSetQuote('pmq', '专案-排屋 Terrace House (Direct On)', 'RM58,980');
  check('quote: typing a quote updates the total only', byId.get('pmq-opp-total').innerHTML.includes('RM 73,980') && !byId.get('pmq-opp-total').innerHTML.includes('need'));
  app.pmfSetQuote('pmq', '六曜指环 Support Power Ring', '');
  const d = app.collectPostMeetupNotesData('pmq');
  check('quote: saved per product (cleared one falls back to list)', JSON.stringify(d.quoted_prices), JSON.stringify({ '专案-排屋 Terrace House (Direct On)': 58980 }));
  oppBoxes.forEach(b => { b.checked = false; });
  check('quote: nothing ticked → null (clears old quotes)', app.collectPostMeetupNotesData('pmq').quoted_prices, null);
  oppBoxes = [];
}
check('ChatGPT prompt asks for one numbered point per line', /numbered points, ONE point per line/.test(fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-activities.js'), 'utf8')));

console.log(`\nminutes-form: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
