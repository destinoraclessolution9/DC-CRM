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
let rows = [], people = [];
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
  setTimeout: () => 0, clearTimeout: () => {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'node-sim' }, URL, Blob: function () {}, FileReader: function () {}, FormData: function () {},
  fetch: async () => ({ ok: false, json: async () => ({}) }),
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'chunks', 'script-activities.js'), 'utf8'), sandbox, { filename: 'script-activities.js' });
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

console.log(`\nminutes-form: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
