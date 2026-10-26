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

// ── numbered points (2026-10-26) ─────────────────────────────────────────
eq('points: chinese paragraph → sentences', h.splitMinutePoints('客户已婚，有两个孩子。在Puchong经营印刷生意，最近销售下滑；希望改善事业运。'),
  ['客户已婚，有两个孩子。', '在Puchong经营印刷生意，最近销售下滑', '希望改善事业运。']);
eq('points: inline numbering', h.splitMinutePoints('1. 想了解PR3 2. 太太决定房子布局 3. 预算约RM18,990'), ['想了解PR3', '太太决定房子布局', '预算约RM18,990']);
eq('points: full-width brackets', h.splitMinutePoints('（1）背景良好（2）对九星课有兴趣'), ['背景良好', '对九星课有兴趣']);
eq('points: bullet lines', h.splitMinutePoints('- 第一点\n• 第二点\n3) 第三点'), ['第一点', '第二点', '第三点']);
eq('points: short note stays one', h.splitMinutePoints('Short note only'), ['Short note only']);
eq('points: times / prices / decimals not split', h.splitMinutePoints('时间 10:30 见面，价格 3.5 万，日期 2026.10'), ['时间 10:30 见面，价格 3.5 万，日期 2026.10']);
eq('points: empty', h.splitMinutePoints('  '), []);
eq('format: numbered lines', h.formatMinutePoints('先了解客户的家庭和事业背景；再向她介绍九星风水基础课的内容；最后约好下次见面时间，带太太一起来讨论房子布局。'),
  '1. 先了解客户的家庭和事业背景\n2. 再向她介绍九星风水基础课的内容\n3. 最后约好下次见面时间，带太太一起来讨论房子布局。');
eq('format: a short paragraph is left as written', h.formatMinutePoints('a；b；c'), 'a；b；c');
eq('format: idempotent', h.formatMinutePoints(h.formatMinutePoints('- x\n- y')), '1. x\n2. y');
eq('format: one point untouched', h.formatMinutePoints('  just one  '), 'just one');

// ── ChatGPT's own layout + ring short codes (Gredgory, 2026-10-26) ──────────
const own = h.parseMeetingMinutes(['客户会面纪要', '客户来源： 米香传福', '客户行业： 理发业', '客户背景', '理发行业',
  '会面重点', '已向客户介绍 Powering 6 与 Powering 4 配套，报价为 RM21,990。', '顾问观察与建议', '仍有跟进机会',
  '客户反应与 DC 相关记录', 'Zyon Tay', '后续跟进', '跟进客户本人', '顾问备注： 记忆不完整'].join('\n'));
eq('own: preamble facts lead the background', own.sections.background, '客户来源：米香传福\n客户行业：理发业\n理发行业');
eq('own: spaced "客户反应与 DC 相关记录" header', own.sections.reaction, 'Zyon Tay');
eq('own: 顾问备注 → advisor', own.sections.advisor, '仍有跟进机会\n记忆不完整');
eq('own: next steps without the note', own.sections.nextActions, ['跟进客户本人']);
eq('own: title line alone is not a fact', h.parseMeetingMinutes('客户会面纪要\n客户背景\nx').sections.background, 'x');
eq('preamble ignored when nothing else is recognised', h.parseMeetingMinutes('客户来源： 米香').recognized, false);

const RINGS = ['一星指环 Power Ring One', '三才禄存 Trinity Power Ring', '五福指环 Five Star Power Ring', '六曜指环 Support Power Ring',
  '七巧增缘 Destiny Power Ring', '八大护法 Prosperity Power Ring', '紫贵右弼 Nine Star Power Ring', '文昌指环 Wisdom Power Ring',
  '掌权班指 Authority Power Ring', '健康指环 Health Power Ring', '大满福 Da Man Fu', '文昌图 Kui Xing Wen Chang Tu 2'];
eq('ring codes', RINGS.map(h.ringCodeOf), ['PR1', 'PR3', 'PR5', 'PR6', 'PR7', 'PR8', 'PR9', 'PR4', 'PR2', 'PRH', null, null]);
eq('alias: Powering 6 / Power Ring 4 / PR 2 / PRH', h.ringAliasesIn('Powering 6, Power Ring 4, PR 2 与 PRH', RINGS),
  ['六曜指环 Support Power Ring', '文昌指环 Wisdom Power Ring', '掌权班指 Authority Power Ring', '健康指环 Health Power Ring']);
eq('alias: PR10 / PRA / April are not rings', h.ringAliasesIn('PR10 PRA April 6', RINGS), []);
const fp = h.findMinutesProducts('会面重点\n已介绍 Powering 6 与 Powering 4 配套，报价为 RM21,990。\n跟进 RM21,990 的 Powering 6\n也谈到大满福', RINGS);
eq('find: rings + catalog name anywhere', fp.matched, ['六曜指环 Support Power Ring', '文昌指环 Wisdom Power Ring', '大满福 Da Man Fu']);
eq('find: one quote line per amount', fp.quotes, ['已介绍 Powering 6 与 Powering 4 配套，报价为 RM21,990。']);
eq('find: nothing named → nothing', h.findMinutesProducts('客户个性较急。报价 RM500', RINGS), { matched: [], quotes: [] });

console.log(`meeting-minutes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
