// ci/test-pipeline-capture.js — the 2026-10-27 pipeline-capture build, client side:
//   * 传福大使 board rendering (reporting chunk _cfBodyHtml): ranking, period,
//     promote / remove for leaders only, the typed-referrer link list.
//   * Pipeline draft deals: ring codes ("PR6", "Powering 4") name catalogue rings.
//   * CPS form "Introduced by (client)": a client referrer fills it, the
//     agent's-own-contact choice, clearing.
// HARNESS: the REAL chunks in a stubbed browser; private helpers reached by
// appending one export line inside each chunk's IIFE (ci/test-whatsapp-list-icon.js).
// The SQL side is ci/sql/pipeline-capture-scenario.sql.
// Run: node ci/test-pipeline-capture.js
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

// ── Fake browser ────────────────────────────────────────────────────────────
global.window = global;
global.self = global;
const noop = () => {};
const asyncNoop = async () => {};
global.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
const byId = new Map();
const el = (id) => { const e = { id, innerHTML: '', value: '', style: {}, focus: noop, scrollIntoView: noop }; byId.set(id, e); return e; };
global.document = {
    getElementById: (id) => byId.get(id) || null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add: noop, remove: noop }, appendChild: noop }),
    addEventListener: noop, body: { appendChild: noop, classList: { add: noop, remove: noop } },
    documentElement: { style: { setProperty: noop } },
};
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node', onLine: true }, configurable: true, writable: true });
global.location = { search: '', href: 'http://localhost/', hash: '' };
global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
global.innerWidth = 1280;
global.addEventListener = noop;
global.removeEventListener = noop;
global.matchMedia = () => ({ matches: false, addListener: noop, addEventListener: noop });
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
const escapeHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
let leader = true;
window._appState = new Proxy({ cu: { id: 1, role: 'Level 5 Team Leader' } }, {
    get: (t, k) => (k in t ? t[k] : null), set: (t, k, v) => { t[k] = v; return true; },
});
window._crmUtils = new Proxy({
    escapeHtml, isTeamLeaderOrAbove: () => leader, isSystemAdmin: () => false, getUserLevel: () => 5,
    debounce: (fn) => fn, debounceCall: (k, fn) => fn(), USER_ROLES: [], isMobile: () => false,
}, { get: (t, k) => (k in t ? t[k] : () => false) });
window.app = new Proxy({}, { get: () => noop });
window.UI = { toast: { success: noop, error: noop, info: noop }, showModal: noop, hideModal: noop, money: (n) => 'RM ' + n, escJsAttr: (s) => String(s) };
global.UI = window.UI;
window.AppDataStore = new Proxy({}, { get: () => asyncNoop });
global.AppDataStore = window.AppDataStore;
window.Auth = { getCurrentUser: asyncNoop };
global.Auth = window.Auth;
window._loadChunk = asyncNoop;
window.Perf = { debounce: (fn) => fn };
eval(fs.readFileSync(path.join(ROOT, 'data-helpers.js'), 'utf8'));

function loadChunk(file, names) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const close = src.lastIndexOf('})();');
    const tag = '__T_' + path.basename(file, '.js').replace(/\W/g, '_');
    eval(src.slice(0, close) + `\n;window.${tag} = { ${names.join(', ')} };\n` + src.slice(close));
    return window[tag];
}
const R = loadChunk('chunks/script-reporting.js', ['_cfBodyHtml', '_cfRange', '_cfOpenPerson']);
const PL = loadChunk('chunks/script-pipeline.js', ['_plProductsInText']);
const A = loadChunk('chunks/script-activities.js', ['selectReferrer', 'selectIntroducer', 'setIntroducerOwn', 'clearIntroducer']);

// ── 传福大使 board ────────────────────────────────────────────────────────────
const data = {
    sum: { cps_total: 117, from_clients: 47, agent_only: 70, own_contact: 0 },
    rows: [
        { person_key: 'p:11', name: 'LIM MIN QI', agent: 'Wong Wai Yeng', is_member: false, cps_period: 4, referred_total: 4, became_customers: 0, sales_rm: 0, last_cps: '2026-08-16' },
        { person_key: 'c:22', name: 'Low <b>Meng</b> Yee', agent: 'Lai Sow Lian', is_member: true, cps_period: 1, referred_total: 2, became_customers: 2, sales_rm: 22980, last_cps: '2026-03-26' },
        { person_key: 'c:23', name: 'Old Referrer', agent: 'X', is_member: false, cps_period: 0, referred_total: 3, became_customers: 1, sales_rm: 5000, last_cps: null },
    ],
    unlinked: [{ ref_text: 'TAN YOKE WEI', people: 15, examples: 'A, B', suggestions: [{ kind: 'Customer', id: 1782483591567, name: 'Tan Yoke Wei', score: 1 }, { kind: 'Consultant', id: 9, name: 'Tan Yoke Wei ', score: 1 }] }],
};
let h = R._cfBodyHtml(data);
ok('board: headline shows the agent-only gap', h.includes('117 CPS') && h.includes('<b>47</b> from clients') && h.includes('70 with no client recorded'));
ok('board: ranked, this year hides people with no CPS this year', h.indexOf('LIM MIN QI') < h.indexOf('Meng') && !h.includes('Old Referrer'));
ok('board: name escaped, member badge', h.includes('Low &lt;b&gt;Meng&lt;/b&gt; Yee') && h.includes('⭐ 传福大使'));
ok('board: sales shown as RM', h.includes('RM22,980'));
ok('board: opens the right record', h.includes('app.showProspectDetail(11)') && h.includes('app.showCustomerDetail(22)'));
ok('board: leader can promote / remove', h.includes("app.cfPromote('p:11', true)") && h.includes("app.cfPromote('c:22', false)"));
ok('board: typed referrers listed with link buttons (collapsed first)', h.includes('Referrers typed as text') && h.includes('15 people') && !h.includes('app.cfLink('));
leader = false;
h = R._cfBodyHtml(data);
ok('board: agents see it read-only', !h.includes('cfPromote') && !h.includes('Referrers typed as text'));
leader = true;
eq('board: open person key', R._cfOpenPerson('c:5'), 'app.showCustomerDetail(5)');
eq('board: bad key opens nothing', R._cfOpenPerson('x:5'), '');
const [qf] = R._cfRange('quarter');
ok('board: quarter starts on a quarter month', /^\d{4}-(01|04|07|10)-01$/.test(qf), qf);
eq('board: all time has no dates', JSON.stringify(R._cfRange('all')), '[null,null]');

// ── pipeline: ring codes name catalogue rings ───────────────────────────────
const products = [{ id: 1, name: '六曜指环 Support Power Ring', price: 18990 }, { id: 2, name: '文昌指环 Wisdom Power Ring', price: 18990 }, { id: 3, name: '大满福 Da Man Fu', price: 3000 }];
const m = PL._plProductsInText('[Products] PR6, Powering 4 | Remarks: x', products).matched.map(p => p.id);
eq('pipeline: PR6 + Powering 4 → the two rings', JSON.stringify(m), '[1,2]');
eq('pipeline: full names still match', JSON.stringify(PL._plProductsInText('[Products] 大满福 Da Man Fu', products).matched.map(p => p.id)), '[3]');
eq('pipeline: PR10 is not a ring', PL._plProductsInText('[Products] PR10', products).matched.length, 0);

// ── CPS form: Introduced by (client) ────────────────────────────────────────
const S = window._appState;
['cps-introducer-info', 'cps-introducer-results', 'cps-introducer', 'cps-referrer-info', 'cps-referrer-results', 'cps-referrer'].forEach(el);
S.si = null;
A.selectReferrer(7, 'Agent Kim', 'Consultant');
ok('intro: an agent referrer does not fill the introducer', S.si === null);
A.selectReferrer(42, 'Aric', 'Customer');
ok('intro: a client referrer is also the introducer', S.si && S.si.id === 42 && S.si.type === 'Customer' && byId.get('cps-introducer-info').innerHTML.includes('Aric'));
A.selectReferrer(43, 'Someone Else', 'Prospect');
ok('intro: a chosen introducer is not overwritten', S.si.id === 42);
A.clearIntroducer();
ok('intro: clear', S.si === null && byId.get('cps-introducer-info').innerHTML === '');
A.setIntroducerOwn();
ok("intro: agent's own contact", S.si && S.si.type === 'Own' && byId.get('cps-introducer-info').innerHTML.includes("Agent's own contact"));
A.selectIntroducer(null, 'Typed <Name>', '');
ok('intro: a typed name is kept, escaped', S.si.name === 'Typed <Name>' && byId.get('cps-introducer-info').innerHTML.includes('Not in system: <strong>Typed &lt;Name&gt;</strong>'));
const actSrc = fs.readFileSync(path.join(ROOT, 'chunks/script-activities.js'), 'utf8');
ok('intro: saved on the new prospect', /introduced_by_id: _state\.si\?\.id \|\| null,\s*introduced_by_type: _state\.si\?\.type \|\| null,\s*introduced_by: _state\.si\?\.name \|\| null,/.test(actSrc));
ok('intro: an agent referrer needs a client or own contact before saving', /_state\.sr\.type === 'Consultant' && !_state\.si/.test(actSrc));

console.log(`\npipeline-capture: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
