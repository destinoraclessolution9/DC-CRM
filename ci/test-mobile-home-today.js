// ci/test-mobile-home-today.js — the phone Home "Today" redesign (2026-10-26):
// goal line, Today (NEXT card + rows + tomorrow), "Do today" rows with one
// action each, a journey WhatsApp step sent from Home, and "my day" filtering.
//
// HARNESS: same technique as ci/test-whatsapp-list-icon.js — loads the REAL
// chunks/script-mobile.js into a stubbed browser and reaches its private
// helpers by appending one export line inside the chunk's IIFE.
// Run: node ci/test-mobile-home-today.js
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
const eq = (name, got, want) => ok(name, got === want, `got:  ${got}\n  want: ${want}`);

// ── Fake browser ────────────────────────────────────────────────────────────
global.window = global;
global.self = global;
const noop = () => {};
const asyncNoop = async () => {};
global.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
global.document = {
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add: noop, remove: noop }, appendChild: noop }),
    addEventListener: noop,
    body: { appendChild: noop, classList: { add: noop, remove: noop } },
    documentElement: { style: { setProperty: noop } },
};
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node', onLine: true }, configurable: true, writable: true });
global.location = { search: '', href: 'http://localhost/', hash: '' };
global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
global.innerWidth = 400;
global.addEventListener = noop;
global.removeEventListener = noop;
global.matchMedia = () => ({ matches: false, addListener: noop, addEventListener: noop });
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const escapeHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
let level = 7;
window._appState = new Proxy({ cu: { id: 42, role: 'Level 7 Agent', full_name: 'Agent Kim' } }, {
    get: (t, k) => (k in t ? t[k] : null), set: (t, k, v) => { t[k] = v; return true; },
});
window._crmUtils = new Proxy({
    escapeHtml,
    waPhone: (raw) => { const d = String(raw || '').replace(/\D/g, ''); return d ? (d.startsWith('60') ? d : d.startsWith('0') ? '6' + d : '60' + d) : ''; },
    getUserLevel: () => level,
    isSystemAdmin: () => level === 1,
    debounce: (fn) => fn, debounceCall: (k, fn) => fn(), USER_ROLES: [],
}, { get: (t, k) => (k in t ? t[k] : () => false) });
const appCalls = [];
window.app = new Proxy({
    apTodoActionHtml: (r) => r.kind === 'collect' ? `<button type="button" class="btn secondary btn-sm" onclick="app.openDeliveryItems('purchase', ${r.ref_id}, ${r.customer_id})">📦 Items</button>` : '',
}, { get: (t, k) => (k in t ? t[k] : (...a) => { appCalls.push([k, ...a]); }) });
const toasts = [];
window.UI = { toast: { success: (m) => toasts.push(['ok', m]), error: (m) => toasts.push(['err', m]), info: noop },
    showModal: noop, hideModal: noop, money: (n) => 'RM ' + n, escJsAttr: (s) => String(s == null ? '' : s).replace(/'/g, "\\'") };
global.UI = window.UI;
const people = { 'customers:9': { id: 9, full_name: 'Ng <b>Jing</b> Yi', phone: '012-345 6789' }, 'prospects:5': { id: 5, full_name: 'No Phone', phone: '' } };
window.AppDataStore = new Proxy({ getById: async (t, id) => people[`${t}:${id}`] || null }, { get: (t, k) => (k in t ? t[k] : asyncNoop) });
global.AppDataStore = window.AppDataStore;
window.Auth = { getCurrentUser: asyncNoop };
global.Auth = window.Auth;
window._loadChunk = asyncNoop;
window.Perf = { debounce: (fn) => fn };

// supabase stub: journey_touchpoints select … maybeSingle / update … eq
const sbCalls = [];
let tpRow = null;
window.supabase = {
    from: (table) => {
        const q = { table, ops: [] };
        const chain = new Proxy({}, {
            get(_, k) {
                if (k === 'then') { sbCalls.push(q); return (res) => Promise.resolve({ data: null, error: null }).then(res); }
                if (k === 'maybeSingle') return () => { sbCalls.push(q); return Promise.resolve({ data: tpRow, error: null }); };
                return (...a) => { q.ops.push([k, ...a]); return chain; };
            },
        });
        return chain;
    },
    rpc: async () => ({ data: [], error: null }),
};
const opened = [];
window.open = (u) => { opened.push(u); return null; };

function loadChunk(file, names) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const close = src.lastIndexOf('})();');
    const bag = `\n;window.__T_home = { ${names.join(', ')} };\n`;
    eval(src.slice(0, close) + bag + src.slice(close));
    return window.__T_home;
}
const M = loadChunk('chunks/script-mobile.js', ['_mhGoalHtml', '_mhTodayHtml', '_mhDoRowHtml', '_mhIsMine', 'mhomeTodoWa']);

(async () => {
    // ── goal line ───────────────────────────────────────────────────────────
    const g1 = M._mhGoalHtml({ me: { won: 40980, n: 2, target: 100000 } });
    ok('goal: own line', g1.includes('This month') && g1.includes('RM40,980') && g1.includes('/ RM100k') && g1.includes('41%') && g1.includes('width:41%'), g1);
    ok('goal: opens Pipeline', g1.includes("app.navigateTo('pipeline')"));
    const g2 = M._mhGoalHtml({ me: { won: 40980, n: 2, target: 100000 }, team: { won: 60970, n: 3, target: 500000 } });
    ok('goal: leader also sees the team', g2.includes('Team') && g2.includes('RM60,970') && g2.includes('/ RM500k') && g2.includes('12%'));
    const g3 = M._mhGoalHtml({ me: { won: 0, n: 0, target: null }, company: { won: 60970, n: 3, target: 1500000 } });
    ok('goal: L1 — company only, no empty own line', !g3.includes('mh-goal-lbl">This month') && g3.includes('mh-goal-lbl">Company') && g3.includes('/ RM1.5M') && g3.includes('4%'), g3);
    ok('goal: over target capped at 100%', M._mhGoalHtml({ me: { won: 250000, n: 5, target: 100000 } }).includes('width:100%'));
    ok('goal: not loaded yet', M._mhGoalHtml(null).includes('loading'));

    // ── my day ──────────────────────────────────────────────────────────────
    ok('mine: I lead it', M._mhIsMine({ lead_agent_id: 42 }));
    ok('mine: I co-run it', M._mhIsMine({ lead_agent_id: 7, co_agents: [{ id: 42 }] }));
    ok('mine: a teammate’s is not', !M._mhIsMine({ lead_agent_id: 7, co_agents: [{ id: 8 }] }));
    level = 1;
    ok('mine: L1 sees every one', M._mhIsMine({ lead_agent_id: 7 }));
    level = 7;

    // ── Today card ──────────────────────────────────────────────────────────
    const acts = [
        { id: 1, start_time: '09:00:00', activity_type: 'CPS', prospect_id: 5 },
        { id: 2, start_time: '14:00:00', activity_type: 'FTF', customer_id: 9, venue_name: 'Menara <DC>' },
        { id: 3, start_time: '16:00:00', activity_type: 'EVENT', activity_title: 'Flexi风水考察' },
    ];
    const who = (a) => (a.customer_id ? people['customers:' + a.customer_id] : a.prospect_id ? people['prospects:' + a.prospect_id] : null);
    const t1 = M._mhTodayHtml(acts, acts[1], who, '12:30', 3);
    const nextBlock = t1.slice(t1.indexOf('mh-next'), t1.indexOf('mh-row', t1.indexOf('mh-next')));
    ok('today: NEXT card for the next one', nextBlock.includes('NEXT') && nextBlock.includes('14:00') && nextBlock.includes('Ng &lt;b&gt;Jing&lt;/b&gt; Yi') && nextBlock.includes('Menara &lt;DC&gt;'));
    ok('today: NEXT has Brief / Minutes / Closing', ["'brief', 2, 9", "'minutes', 2, 9", "'closing', 2, 9"].every(x => nextBlock.includes(x)));
    ok('today: past meet-up row offers Minutes only', /mh-row past[\s\S]*09:00[\s\S]*'minutes', 1, 5/.test(t1) && !t1.includes("'closing', 1, 5"));
    ok('today: event row has no meet-up buttons', !t1.includes("'minutes', 3"));
    ok('today: a later meet-up gets no Minutes yet', !M._mhTodayHtml([...acts, { id: 5, start_time: '18:00:00', activity_type: 'FTF', prospect_id: 5 }], acts[1], who, '12:30', 3).includes("'minutes', 5"));
    ok('today: tap opens the activity', t1.includes("app.mcalOpenEvent('2', null, 9)"));
    ok('today: tomorrow count', t1.includes('Tomorrow: 3 meet-ups'));
    ok('today: tomorrow not loaded → no line', !M._mhTodayHtml(acts, acts[1], who, '12:30', null).includes('Tomorrow'));
    ok('today: nothing booked', M._mhTodayHtml([], null, who, '12:30', 0).includes('Nothing booked today') && M._mhTodayHtml([], null, who, '12:30', 0).includes('nothing booked yet'));

    // ── Do-today rows ───────────────────────────────────────────────────────
    const wa = M._mhDoRowHtml({ kind: 'touch', icon: '🧭', prospect_id: 5, name: 'Wong', why: 'Ready for pickup', ref_id: 88, tp_type: 'whatsapp_auto' }, 0);
    ok('do: WhatsApp step → WhatsApp button', wa.includes('app.mhomeTodoWa(88)') && wa.includes('fa-whatsapp'));
    ok('do: row opens the person', wa.includes("app.apOpen('prospect', 5)"));
    const call = M._mhDoRowHtml({ kind: 'touch', icon: '🧭', prospect_id: 5, name: 'Liew', why: 'CPS跟进电话 · overdue', ref_id: 89, tp_type: 'call' }, 1);
    ok('do: call step → Done', call.includes('app.mhomeTodoDone(89)') && !call.includes('mhomeTodoWa'));
    const col = M._mhDoRowHtml({ kind: 'collect', icon: '📦', prospect_id: 4, customer_id: 9, name: 'Tan <i>', why: 'Collect · ready since 10 Aug', ref_id: 700 }, 2);
    ok('do: other kinds use the shared buttons', col.includes("app.openDeliveryItems('purchase', 700, 9)") && col.includes('mh-do-act'));
    ok('do: name escaped, customer opened as customer', col.includes('Tan &lt;i&gt;') && col.includes("app.apOpen('customer', 9)"));
    const dr = M._mhDoRowHtml({ kind: 'draft', icon: '💬', name: 'Lee', why: '推荐名单致谢 · today', draftId: 31, pid: 77, isCust: false, phone: "01'2" }, 3);
    ok('do: follow-up draft → WhatsApp + refresh', dr.includes("app.mhomeFollowupWa(31, '77', '01\\'2', false)") && dr.includes('mhomeTodoRefresh'));

    // ── journey WhatsApp step sent from Home ────────────────────────────────
    tpRow = { id: 88, title: '📦 Step 3 — 准备领取通知WA', message_template: '嗨 {name}！好消息 🎉', customer_id: 9, prospect_id: null };
    await M.mhomeTodoWa(88);
    eq('wa: opens WhatsApp with the message, full name filled', opened.pop(), 'https://wa.me/60123456789?text=' + encodeURIComponent('嗨 Ng <b>Jing</b> Yi！好消息 🎉'));
    const upd = sbCalls.find(q => q.ops.some(o => o[0] === 'update'));
    ok('wa: step marked done', !!upd && upd.ops.find(o => o[0] === 'update')[1].status === 'done' && upd.ops.some(o => o[0] === 'eq' && o[2] === 88));
    sbCalls.length = 0;
    tpRow = { id: 90, title: 'x', message_template: 'hi', prospect_id: 5, customer_id: null };
    await M.mhomeTodoWa(90);
    ok('wa: no phone → message, nothing opened, not ticked', opened.length === 0 && toasts.some(t => t[0] === 'err' && /No phone/.test(t[1])) && !sbCalls.some(q => q.ops.some(o => o[0] === 'update')));

    console.log(`\nmobile-home-today: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
