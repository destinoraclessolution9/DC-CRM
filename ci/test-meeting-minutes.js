// ci/test-meeting-minutes.js — the ChatGPT-minutes paste parser + checkbox
// matcher (data-helpers.js parseMeetingMinutes / matchMinutesItems).
// Run: node ci/test-meeting-minutes.js
'use strict';
const h = require('../data-helpers.js');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.error(`FAIL ${name}\n     got:  ${g}\n     want: ${w}`);
}

// ── 1. The exact format the CRM's "Copy ChatGPT prompt" asks for ──────────
const full = `1. 客户背景 (Customer Background)
- 已婚，两个孩子，太太是老师
- 在KL做工程师，计划明年换房
2. 会面重点 (Meeting Key Points)
- 最近工作不顺，想了解家里风水
3. 顾问观察与建议 (Advisor Observations & Suggestions)
- 建议先上个人风水基础课，三个月内调整睡房
4. 客户反应与DC记录 (Customer Reaction & DC Records)
- 反应积极，之前参加过博物馆
5. 后续跟进与下一步行动 (Next Actions)
- 个人风水基础课（下周六）
- 博物馆
- 下周三打电话跟进
6. 潜在机会与产品 (Potential & Opportunities)
- 简易 Simple Plan
- 大满福 Da Man Fu
7. 客户评级 (Grade)
- B
8. 会面结果 (Meeting Result)
- Positive`;
const p = h.parseMeetingMinutes(full);
eq('full: recognized', p.recognized, true);
eq('full: all 8 found', p.found.length, 8);
eq('full: background keeps both lines as bullets', p.sections.background, '• 已婚，两个孩子，太太是老师\n• 在KL做工程师，计划明年换房');
eq('full: single-line section has no bullet prefix', p.sections.keyPoints, '最近工作不顺，想了解家里风水');
eq('full: advisor', p.sections.advisor, '建议先上个人风水基础课，三个月内调整睡房');
eq('full: reaction', p.sections.reaction, '反应积极，之前参加过博物馆');
eq('full: next actions list', p.sections.nextActions, ['个人风水基础课（下周六）', '博物馆', '下周三打电话跟进']);
eq('full: opportunities list', p.sections.opportunities, ['简易 Simple Plan', '大满福 Da Man Fu']);
eq('full: grade', p.grade, 'B');
eq('full: outcome', p.outcome, 'positive');

// ── 2. The pasted-spec variant: ### headers, * bullets, wrapper lines ─────
const hashes = `Here are your minutes:
--- OUTPUT FORMAT START ---
### 1. 客户背景 (Customer Background)
* 单身，做生意
### 2. 会面重点 (Meeting Key Points)
* 想开新店
### 3. 顾问观察与建议 (Advisor Observations & Suggestions)
### 4. 客户反应与DC记录 (Customer Reaction & DC Records)
* [Reaction to advice, class/event participation, interactions]
### 5. 后续跟进与下一步行动 (Next Actions)
* [Action 1]
* [Action 2]
### 7. 客户评级 (Grade)
* A
--- OUTPUT FORMAT END ---`;
const q = h.parseMeetingMinutes(hashes);
eq('###: preamble ignored, background', q.sections.background, '单身，做生意');
eq('###: key points', q.sections.keyPoints, '想开新店');
eq('###: empty advisor section → absent', q.sections.advisor, undefined);
eq('###: placeholder-only reaction → absent', q.sections.reaction, undefined);
eq('###: placeholder actions skipped', q.sections.nextActions, undefined);
eq('###: missing opportunities → absent', q.sections.opportunities, undefined);
eq('###: grade A', q.grade, 'A');
eq('###: no outcome', q.outcome, null);
eq('###: OUTPUT FORMAT END line not swallowed into grade', q.sections.grade, 'A');

// ── 3. English-only, bold headers, "Header: value" on one line ───────────
const en = `**Customer Background**
- Retired couple, 3 grandchildren
**Meeting Key Points:** worried about health at home
**Advisor Observations & Suggestions**
- Move the bed away from the window
**Next Actions**
- 博物馆 visit next month
Grade: C
Meeting Result: Not interested in big plans for now`;
const e = h.parseMeetingMinutes(en);
eq('en: background', e.sections.background, 'Retired couple, 3 grandchildren');
eq('en: inline header value', e.sections.keyPoints, 'worried about health at home');
eq('en: advisor', e.sections.advisor, 'Move the bed away from the window');
eq('en: grade inline', e.grade, 'C');
eq('en: "not interested" beats "interested"', e.outcome, 'not_interested');

// ── 4. Content lines that merely START with a section word stay content ──
const tricky = `4. 客户反应与DC记录 (Customer Reaction & DC Records)
- 客户反应积极，表示愿意参加课程
客户反应很好
2. 会面重点 (Meeting Key Points)
1. 先谈家里风水
2. 再谈公司搬迁`;
const t = h.parseMeetingMinutes(tricky);
eq('tricky: reaction keeps both lines', t.sections.reaction, '• 客户反应积极，表示愿意参加课程\n客户反应很好');
eq('tricky: numbered content inside a section', t.sections.keyPoints, '• 先谈家里风水\n• 再谈公司搬迁');
// A numbered line repeating an already-seen section word is content (seen guard).
const t2 = h.parseMeetingMinutes(`4. 客户反应与DC记录 (Customer Reaction & DC Records)\n- 很满意\n1. 客户反应很好`);
eq('seen-guard: second "header" of a seen section is content', t2.sections.reaction, '• 很满意\n• 客户反应很好');
// A numbered sentence that contains another section's word is content (residue check).
const t3 = h.parseMeetingMinutes(`2. 会面重点 (Meeting Key Points)\n1. 客户反应积极，表示愿意参加课程\n2. 想换房`);
eq('residue: long sentence is not a header', t3.sections.keyPoints, '• 客户反应积极，表示愿意参加课程\n• 想换房');
eq('residue: reaction not stolen', t3.sections.reaction, undefined);
// Numbered template placeholders are skipped too.
eq('placeholder: numbered', h.parseMeetingMinutes(`5. 后续跟进与下一步行动 (Next Actions)\n1. [Action 1]\n2. 博物馆`).sections.nextActions, ['博物馆']);

// ── 5. Grade / outcome readings ───────────────────────────────────────────
const g = (s) => h.parseMeetingMinutes(`7. 客户评级 (Grade)\n${s}`).grade;
eq('grade: B级', g('- B级 (有潜力)'), 'B');
eq('grade: lowercase lone', g('- a'), 'A');
eq('grade: article "a" is not a grade', g('- a good prospect'), null);
eq('grade: DC is not D', g('- DC member, not graded'), null);
eq('grade: F', g('- F · 放弃'), 'F');
const o = (s) => h.parseMeetingMinutes(`8. 会面结果 (Meeting Result)\n${s}`).outcome;
eq('outcome: 积极', o('- 积极'), 'positive');
eq('outcome: 一般', o('- 一般'), 'neutral');
eq('outcome: Negative', o('- Negative'), 'negative');
eq('outcome: 没有兴趣 (contains 有兴趣)', o('- 没有兴趣'), 'not_interested');
eq('outcome: unreadable', o('- maybe later'), null);

// ── 6. Not the format at all ──────────────────────────────────────────────
const junk = h.parseMeetingMinutes('met him at starbucks, he wants to buy a condo');
eq('junk: not recognized', junk.recognized, false);
eq('junk: empty input', h.parseMeetingMinutes('').recognized, false);
eq('junk: CRLF safe', h.parseMeetingMinutes('1. 客户背景\r\n- x\r\n').sections.background, 'x');

// ── 7. matchMinutesItems ──────────────────────────────────────────────────
const cats = ['个人风水基础课', '博物馆', '汇集-简易', '汇集简易-Condo', '风水改命分享会-简易', 'DC 日'];
const m1 = h.matchMinutesItems(['个人风水基础课（下周六）', '博物馆', '下周三打电话跟进'], cats);
eq('match: categories ticked', m1.matched, ['个人风水基础课', '博物馆']);
eq('match: free action → leftover', m1.leftovers, ['下周三打电话跟进']);
eq('match: detail kept as extra', m1.extra, ['个人风水基础课（下周六）']);
eq('match: longest wins', h.matchMinutesItems(['汇集简易 Condo'], cats).matched, ['汇集简易-Condo']);
eq('match: case/space-insensitive', h.matchMinutesItems(['dc日'], cats).matched, ['DC 日']);
eq('match: ambiguous run → leftover', h.matchMinutesItems(['简易'], ['汇集-简易', '风水改命分享会-简易']).matched, []);

const products = ['简易 Simple Plan', '大满福 Da Man Fu', '专案 Premium Plan', 'Formula Day Cream'];
const m2 = h.matchMinutesItems(['简易 Simple Plan', 'Da Man Fu (大满福)', '专案', 'day cream', '一块玉'], products);
eq('match: exact product', m2.matched.includes('简易 Simple Plan'), true);
eq('match: reordered bilingual name via run', m2.matched.includes('大满福 Da Man Fu'), true);
eq('match: Chinese-only alias via run', m2.matched.includes('专案 Premium Plan'), true);
eq('match: partial English (reverse containment)', m2.matched.includes('Formula Day Cream'), true);
eq('match: unknown product → leftover', m2.leftovers, ['一块玉']);
eq('match: two products in one line', h.matchMinutesItems(['简易 Simple Plan、大满福 Da Man Fu'], products).matched, ['简易 Simple Plan', '大满福 Da Man Fu']);
eq('match: empty inputs', h.matchMinutesItems([], products), { matched: [], leftovers: [], extra: [] });

console.log(`meeting-minutes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
