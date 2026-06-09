-- ============================================================
-- ROS Upgrade — 21-Step Journey + Product Tracks + Full Conditions
-- DestinOraclesSolution CRM · Migration 20260607
-- Run in: Supabase Dashboard → SQL Editor
-- Pre-requisite: 20260606_journey_system.sql must already be applied
-- ============================================================

-- ── 1. Add new columns ────────────────────────────────────────────────────────

ALTER TABLE public.journey_templates
    ADD COLUMN IF NOT EXISTS product_track TEXT DEFAULT NULL,   -- 'pr'|'fs'|'cal'|'bed'|'sofa'|'curtain'|'hc'|'all'
    ADD COLUMN IF NOT EXISTS follow_mode   TEXT DEFAULT 'active'; -- 'active'|'warm_hold'|'gentle_nurture'

ALTER TABLE public.journey_touchpoints
    ADD COLUMN IF NOT EXISTS product_track TEXT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS follow_mode   TEXT DEFAULT 'active';

-- Index: filter touchpoints by product track
CREATE INDEX IF NOT EXISTS idx_jt_product_track ON public.journey_touchpoints(product_track) WHERE product_track IS NOT NULL;

-- ── 2. Expand action CHECK on conditional_rules (add escalate + role_upgrade) ─

ALTER TABLE public.conditional_rules
    DROP CONSTRAINT IF EXISTS conditional_rules_action_check;

ALTER TABLE public.conditional_rules
    ADD CONSTRAINT conditional_rules_action_check CHECK (action IN (
        'skip_to_stage','move_to_nurture','accelerate','pause',
        'move_to_active','escalate','role_upgrade'
    ));

-- ── 3. Delete old generic pre-purchase + post-purchase seed templates ─────────
--    (Keep track='nurture' rows — they remain valid)

DELETE FROM public.journey_templates
WHERE track IN ('active')
  AND stage_name IN (
    'first_contact','engagement','value_milestone','decision',
    'onboarding','active_client_y1','growth_y2','growth_y3','growth_y4','growth_y5'
  );

-- ── 4. Insert all new templates ───────────────────────────────────────────────
--    Columns: name, track, stage_name, product_track, days_offset, touchpoint_type,
--             message_template, assigned_to_role, escalates_to_role, escalate_after_days,
--             priority, follow_mode, sort_order

INSERT INTO public.journey_templates
    (name, track, stage_name, product_track, days_offset, touchpoint_type,
     message_template, assigned_to_role, escalates_to_role, escalate_after_days,
     priority, follow_mode, sort_order)
VALUES

-- ════════════════════════════════════════════════════════════════════════════════
-- POWER RING TRACK (pr_)  ·  CPS → 九星课 → 改命会 → 博物馆 → 汇集 → FSA → Purchase
-- ════════════════════════════════════════════════════════════════════════════════

-- pr_post_cps: Just completed CPS, ring interest noted. Goal: get to 九星基础课.
('💍 感谢CPS — 下一步介绍', 'active','pr_post_cps','pr', 1,'whatsapp_auto',
 '嗨 {name}！很开心今天和您聊了。您对个人改命的兴趣让我印象深刻！我们的《九星风水基础课》专门讲解如何通过能量布局改变命格。下期课程就快开始了，我会第一时间通知您。有什么问题随时找我 🙏',
 'system','agent',3,'high','active',100),

('💍 CPS跟进电话', 'active','pr_post_cps','pr', 3,'call', NULL,
 'agent','team_leader',3,'high','active',110),

-- pr_invited_9star: Invited to 九星课, not yet confirmed.
('💍 九星课 — 确认出席', 'active','pr_invited_9star','pr', 1,'whatsapp_auto',
 '嗨 {name}！想再确认一下，您是否能参加这期的《九星风水基础课》？这堂课直接影响到后面的分析方向，参加的人都说非常开眼界。我帮您保留名额 😊',
 'system','agent',3,'high','active',120),

('💍 九星课 — 未回覆提醒', 'active','pr_invited_9star','pr', 5,'task', NULL,
 'agent','team_leader',3,'med','active',130),

-- pr_post_9star: Attended 九星课. Goal: get to 个人改命分享会.
('💍 九星课后 — 心得分享WA', 'active','pr_post_9star','pr', 1,'whatsapp_auto',
 '嗨 {name}！昨天的九星课感觉如何？根据您的出生年，您的命盘里有几个特别关键的能量缺口，在下次的《个人改命分享会》我们会更深入讲解如何通过改命戒指来补运。下期分享会我帮您留位置？',
 'system','agent',3,'high','active',140),

('💍 九星课后 — 邀请改命分享会', 'active','pr_post_9star','pr', 3,'call', NULL,
 'agent','team_leader',3,'high','active',150),

-- pr_invited_sharing: Invited to 个人改命分享会.
('💍 改命会 — 确认出席', 'active','pr_invited_sharing','pr', 1,'whatsapp_auto',
 '嗨 {name}！想确认您是否参加这期的《个人改命分享会》。上期有位学员在分享会后当天就决定改变——因为分析太准了。期待您的到来！',
 'system','agent',3,'high','active',160),

('💍 改命会 — 再次提醒', 'active','pr_invited_sharing','pr', 5,'task', NULL,
 'agent','team_leader',3,'med','active',170),

-- pr_post_sharing: Attended 改命分享会. Goal: museum.
('💍 改命会后 — 博物馆邀请', 'active','pr_post_sharing','pr', 1,'whatsapp_auto',
 '嗨 {name}！昨天的改命分享会您的反应让我知道您是认真看待改命的！下一步是参观我们的《改命博物馆》，里面有几百年历史的风水文物，很多客户说参观后才真正明白改命的深度。我帮您安排？',
 'system','agent',3,'high','active',180),

('💍 改命会后 — 博物馆跟进', 'active','pr_post_sharing','pr', 3,'task', NULL,
 'agent','team_leader',3,'high','active',190),

-- pr_invited_museum: Invited to museum.
('💍 博物馆 — 确认时间', 'active','pr_invited_museum','pr', 1,'whatsapp_auto',
 '嗨 {name}！我们的博物馆参观名额有限，想帮您确认这次的安排。参观后会有专人根据您的八字（命格）为您导览，非常个人化的体验！',
 'system','agent',3,'high','active',200),

('💍 博物馆 — 未回覆提醒', 'active','pr_invited_museum','pr', 5,'task', NULL,
 'agent','team_leader',3,'med','active',210),

-- pr_post_museum: Attended museum. Goal: 汇集.
('💍 博物馆后 — 汇集邀请', 'active','pr_post_museum','pr', 1,'whatsapp_auto',
 '嗨 {name}！参观博物馆后您的感悟让我很感动！现在邀请您参加《汇集》——这是我们最高规格的能量汇聚活动，现场会有多位改命成功的客户分享真实案例。这是您正式开启改命旅程最重要的一步！',
 'system','agent',3,'high','active',220),

('💍 博物馆后 — 跟进确认汇集', 'active','pr_post_museum','pr', 3,'call', NULL,
 'agent','team_leader',3,'high','active',230),

-- pr_invited_huiji: Invited to 汇集.
('💍 汇集 — 确认出席', 'active','pr_invited_huiji','pr', 1,'whatsapp_auto',
 '嗨 {name}！这次《汇集》来的都是真正在认真看待自己人生的人，能量会很不一样。我帮您保留了位置，请问您能来吗？',
 'system','agent',3,'high','warm_hold',240),

('💍 汇集 — 温馨提醒', 'active','pr_invited_huiji','pr', 5,'task', NULL,
 'agent','team_leader',3,'med','active',250),

-- pr_post_huiji: Attended 汇集. Goal: 1-to-1 FSA.
('💍 汇集后 — 个人FSA预约', 'active','pr_post_huiji','pr', 1,'whatsapp_auto',
 '嗨 {name}！经过了整个学习过程，现在是时候做一个专属于您的《个人风水方案分析》了。这个1对1的分析会把您的八字、居家环境和事业目标完整整合，给您一个清晰的改命路线图。您方便约时间吗？',
 'system','agent',3,'high','active',260),

('💍 汇集后 — 预约FSA提醒', 'active','pr_post_huiji','pr', 3,'call', NULL,
 'agent','team_leader',3,'high','active',270),

-- pr_fsa_scheduled: FSA appointment confirmed/done.
('💍 FSA前 — 提醒准备资料', 'active','pr_fsa_scheduled','pr', 0,'whatsapp_auto',
 '嗨 {name}！明天的个人风水方案分析，麻烦您准备好：①家/公司平面图照片 ②出生日期时辰 ③近3年遇到的主要挑战。这样我们的分析会更精准！',
 'system','agent',2,'high','warm_hold',280),

('💍 FSA后 — 方案跟进', 'active','pr_fsa_scheduled','pr', 1,'call', NULL,
 'agent','team_leader',2,'high','active',290),

-- pr_decision: Proposal presented, awaiting purchase decision.
('💍 方案决定 — 关切跟进', 'active','pr_decision','pr', 3,'whatsapp_auto',
 '嗨 {name}！之前分析的改命方案，不知道您看了之后有什么感想或疑问？有任何不清楚的地方我都可以帮您解释。改变命格这条路，主动权在您手上 🙏',
 'agent','team_leader',5,'high','active',300),

('💍 方案决定 — TL电话跟进', 'active','pr_decision','pr', 7,'call', NULL,
 'team_leader','manager',5,'high','active',310),

('💍 方案决定 — 最终确认', 'active','pr_decision','pr',14,'meeting', NULL,
 'team_leader','manager',7,'high','gentle_nurture',320),

-- ════════════════════════════════════════════════════════════════════════════════
-- FENG SHUI AUDIT TRACK (fs_)  ·  CPS → DIY → 风水会 → 博物馆 → 汇集专案 → FSA → Purchase
-- ════════════════════════════════════════════════════════════════════════════════

('🏠 感谢CPS — 风水DIY介绍', 'active','fs_post_cps','fs', 1,'whatsapp_auto',
 '嗨 {name}！今天聊到您对居家/办公室风水改善的需求，这让我想到我们的《环境风水基础课（DIY）》非常适合您先来了解。这堂课会教您如何判断自己空间里的能量流向，非常实用！下期我帮您留名额？',
 'system','agent',3,'high','active',400),

('🏠 CPS风水跟进', 'active','fs_post_cps','fs', 3,'call', NULL,
 'agent','team_leader',3,'high','active',410),

('🏠 风水DIY课 — 确认出席', 'active','fs_invited_diy','fs', 1,'whatsapp_auto',
 '嗨 {name}！想确认您能参加《环境风水DIY基础课》吗？上期学员反馈说光是学会看门向和灶向就已经值回票价！',
 'system','agent',3,'high','active',420),

('🏠 风水DIY课 — 提醒', 'active','fs_invited_diy','fs', 5,'task', NULL,
 'agent','team_leader',3,'med','active',430),

('🏠 DIY课后 — 分享会邀请', 'active','fs_post_diy','fs', 1,'whatsapp_auto',
 '嗨 {name}！上次的DIY课您应该对风水有了基础了解。现在邀请您参加《风水改命分享会》，里面会讲到更深层的环境能量整合，很多案例都是真实客户的改变故事。您有兴趣吗？',
 'system','agent',3,'high','active',440),

('🏠 DIY课后 — 跟进分享会', 'active','fs_post_diy','fs', 3,'call', NULL,
 'agent','team_leader',3,'high','active',450),

('🏠 风水分享会 — 确认出席', 'active','fs_invited_sharing','fs', 1,'whatsapp_auto',
 '嗨 {name}！《风水改命分享会》就快到了，您能来吗？这次会有几个家庭改变案例特别值得听，和您的需求很相似！',
 'system','agent',3,'high','active',460),

('🏠 风水分享会 — 提醒', 'active','fs_invited_sharing','fs', 5,'task', NULL,
 'agent','team_leader',3,'med','active',470),

('🏠 风水分享会后 — 博物馆邀请', 'active','fs_post_sharing','fs', 1,'whatsapp_auto',
 '嗨 {name}！分享会后您提的那个问题让我觉得您已经准备好进一步了解了！建议您参观我们的《改命博物馆》，里面的几百年藏品会给您对环境风水一个全新的视角。',
 'system','agent',3,'high','active',480),

('🏠 风水分享会后 — 跟进博物馆', 'active','fs_post_sharing','fs', 3,'call', NULL,
 'agent','team_leader',3,'high','active',490),

('🏠 博物馆 — 确认参观', 'active','fs_invited_museum','fs', 1,'whatsapp_auto',
 '嗨 {name}！博物馆参观需要预约，我帮您确认这次能来吗？参观过的客户都说，亲眼见到那些风水文物比任何理论都有说服力。',
 'system','agent',3,'high','active',500),

('🏠 博物馆 — 提醒', 'active','fs_invited_museum','fs', 5,'task', NULL,
 'agent','team_leader',3,'med','active',510),

('🏠 博物馆后 — 汇集专案邀请', 'active','fs_post_museum','fs', 1,'whatsapp_auto',
 '嗨 {name}！走过了这一段学习之后，现在正式邀请您参加《汇集专案》。这是专为认真考虑全套风水改造方案的客户设计的高端活动，届时会有资深风水师现场解答。',
 'system','agent',3,'high','active',520),

('🏠 博物馆后 — 汇集专案跟进', 'active','fs_post_museum','fs', 3,'call', NULL,
 'agent','team_leader',3,'high','active',530),

('🏠 汇集专案 — 确认出席', 'active','fs_invited_huiji','fs', 1,'whatsapp_auto',
 '嗨 {name}！《汇集专案》的名额非常有限，我帮您确认出席可以吗？这是您在正式提交风水方案前最重要的一步！',
 'system','agent',3,'high','warm_hold',540),

('🏠 汇集专案 — 温馨提醒', 'active','fs_invited_huiji','fs', 5,'task', NULL,
 'agent','team_leader',3,'med','active',550),

('🏠 汇集后 — 预约FSA', 'active','fs_post_huiji','fs', 1,'whatsapp_auto',
 '嗨 {name}！走过了整个学习流程，现在最重要的一步是做您的《居家/办公室风水全面分析》。我会安排资深顾问带着您的平面图和照片，给您一个完整的改造方案。方便约时间吗？',
 'system','agent',3,'high','active',560),

('🏠 汇集后 — FSA预约跟进', 'active','fs_post_huiji','fs', 3,'call', NULL,
 'agent','team_leader',3,'high','active',570),

('🏠 FSA前 — 资料准备提醒', 'active','fs_fsa_scheduled','fs', 0,'whatsapp_auto',
 '嗨 {name}！明天的风水方案分析，请准备：①家/办公室平面图 ②房子门朝向 ③近年遇到的主要问题（健康/事业/感情）。照片也很欢迎！',
 'system','agent',2,'high','warm_hold',580),

('🏠 FSA后 — 方案跟进', 'active','fs_fsa_scheduled','fs', 1,'call', NULL,
 'agent','team_leader',2,'high','active',590),

('🏠 方案决定 — 关切跟进', 'active','fs_decision','fs', 3,'whatsapp_auto',
 '嗨 {name}！之前提出的风水改造方案，您有没有机会思考了？我们明白这是一个需要认真考虑的决定。有任何疑问我都可以帮您深入解释。',
 'agent','team_leader',5,'high','active',600),

('🏠 方案决定 — TL跟进', 'active','fs_decision','fs', 7,'call', NULL,
 'team_leader','manager',5,'high','active',610),

('🏠 方案决定 — 最终确认', 'active','fs_decision','fs',14,'meeting', NULL,
 'team_leader','manager',7,'high','gentle_nurture',620),

-- ════════════════════════════════════════════════════════════════════════════════
-- CALLIGRAPHY TRACK (cal_)  ·  CPS → 画作会 → 艺品会 → 汇集 → Purchase
-- ════════════════════════════════════════════════════════════════════════════════

('🖌️ 感谢CPS — 画作介绍', 'active','cal_post_cps','cal', 1,'whatsapp_auto',
 '嗨 {name}！今天聊到您对风水画作的兴趣！每幅画作都有特定的能量寓意，挂在正确位置能激活居家或办公室的旺气。我们的《画作分享会》会详细介绍。我帮您留位置？',
 'system','agent',3,'high','active',700),

('🖌️ CPS画作跟进', 'active','cal_post_cps','cal', 3,'call', NULL,
 'agent','team_leader',3,'high','active',710),

('🖌️ 画作分享会 — 确认出席', 'active','cal_invited_sharing','cal', 1,'whatsapp_auto',
 '嗨 {name}！这期《画作分享会》会展示几幅特别罕见的能量画作，画家本身也会到场分享创作背后的风水意涵。您能来吗？',
 'system','agent',3,'high','active',720),

('🖌️ 画作分享会 — 提醒', 'active','cal_invited_sharing','cal', 5,'task', NULL,
 'agent','team_leader',3,'med','active',730),

('🖌️ 画作分享会后 — 艺品会邀请', 'active','cal_post_sharing','cal', 1,'whatsapp_auto',
 '嗨 {name}！很高兴您参加了画作分享会！接下来的《艺品分享会》会让您近距离接触真正的风水艺品，包括一些限量典藏作品。这是进一步了解的最好机会！',
 'system','agent',3,'high','active',740),

('🖌️ 画作分享会后 — 艺品会跟进', 'active','cal_post_sharing','cal', 3,'call', NULL,
 'agent','team_leader',3,'high','active',750),

('🖌️ 艺品分享会 — 确认出席', 'active','cal_invited_art','cal', 1,'whatsapp_auto',
 '嗨 {name}！《艺品分享会》就快到了，您能来吗？这次展出的几件作品非常特别，我已经为您保留了观赏位置。',
 'system','agent',3,'high','active',760),

('🖌️ 艺品分享会 — 提醒', 'active','cal_invited_art','cal', 5,'task', NULL,
 'agent','team_leader',3,'med','active',770),

('🖌️ 艺品分享会后 — 汇集邀请', 'active','cal_post_art','cal', 1,'whatsapp_auto',
 '嗨 {name}！您对艺品的眼光非常好！现在诚邀您参加《汇集》，届时会有完整的收藏方案介绍，以及如何将艺品与居家风水完美结合。',
 'system','agent',3,'high','active',780),

('🖌️ 艺品分享会后 — 汇集跟进', 'active','cal_post_art','cal', 3,'call', NULL,
 'agent','team_leader',3,'high','active',790),

('🖌️ 汇集 — 确认出席', 'active','cal_invited_huiji','cal', 1,'whatsapp_auto',
 '嗨 {name}！《汇集》名额有限，请确认您的出席。这是您在选择收藏方案前最全面的一次体验！',
 'system','agent',3,'high','warm_hold',800),

('🖌️ 汇集 — 提醒', 'active','cal_invited_huiji','cal', 5,'task', NULL,
 'agent','team_leader',3,'med','active',810),

('🖌️ 汇集后 — 收藏方案跟进', 'active','cal_post_huiji','cal', 1,'whatsapp_auto',
 '嗨 {name}！汇集结束后您对哪几件作品最有感觉？我可以帮您了解更多关于那几件的能量寓意和摆放建议。',
 'system','agent',3,'high','active',820),

('🖌️ 汇集后 — 收藏决定跟进', 'active','cal_post_huiji','cal', 3,'call', NULL,
 'agent','team_leader',3,'high','active',830),

('🖌️ 收藏决定 — 跟进', 'active','cal_decision','cal', 3,'whatsapp_auto',
 '嗨 {name}！关于那几件您感兴趣的画作，我整理了一份摆放方位和能量分析给您参考。有时间的话我们再深聊一下？',
 'agent','team_leader',5,'high','active',840),

('🖌️ 收藏决定 — TL介入', 'active','cal_decision','cal', 7,'call', NULL,
 'team_leader','manager',5,'high','active',850),

('🖌️ 收藏决定 — 最终确认', 'active','cal_decision','cal',14,'meeting', NULL,
 'team_leader','manager',7,'high','gentle_nurture',860),

-- ════════════════════════════════════════════════════════════════════════════════
-- BUJISHU BED TRACK (bed_)
-- ════════════════════════════════════════════════════════════════════════════════

('🛏️ 感谢CPS — 旺床介绍', 'active','bed_post_cps','bed', 1,'whatsapp_auto',
 '嗨 {name}！睡眠方向是风水里影响最直接的因素之一。我们的《旺床/满堂系列》专门针对卧室能量优化——很多客户改变床向后睡眠质量和运气都明显改善。分享会我帮您留位？',
 'system','agent',3,'high','active',900),

('🛏️ 旺床分享会 — 确认出席', 'active','bed_invited_sharing','bed', 1,'whatsapp_auto',
 '嗨 {name}！《旺床/满堂分享会》就快到了，您能来吗？现场会示范如何判断您家的最佳床位方向！',
 'system','agent',3,'high','active',910),

('🛏️ 旺床分享会后 — 汇集邀请', 'active','bed_post_sharing','bed', 1,'whatsapp_auto',
 '嗨 {name}！分享会后对旺床系列有兴趣的朋友，我们特别安排了《汇集》让大家更深入了解整套系统。要来吗？',
 'system','agent',3,'high','active',920),

('🛏️ 汇集 — 确认出席', 'active','bed_invited_huiji','bed', 1,'whatsapp_auto',
 '嗨 {name}！《汇集》名额有限，帮您确认出席？这是旺床方案正式开始前最后一步！',
 'system','agent',3,'high','warm_hold',930),

('🛏️ 汇集后 — 方案跟进', 'active','bed_post_huiji','bed', 1,'call', NULL,
 'agent','team_leader',3,'high','active',940),

('🛏️ 方案决定 — 跟进', 'active','bed_decision','bed', 3,'whatsapp_auto',
 '嗨 {name}！旺床方案您有没有机会看一看？有任何关于材质、方位或摆设的问题我都可以回答。',
 'agent','team_leader',5,'high','active',950),

('🛏️ 方案决定 — TL介入', 'active','bed_decision','bed', 7,'call', NULL,
 'team_leader','manager',5,'high','active',960),

-- ════════════════════════════════════════════════════════════════════════════════
-- BUJISHU SOFA TRACK (sofa_)
-- ════════════════════════════════════════════════════════════════════════════════

('🛋️ 感谢CPS — 旺沙发介绍', 'active','sofa_post_cps','sofa', 1,'whatsapp_auto',
 '嗨 {name}！客厅是家里凝聚能量最重要的空间。我们的《旺沙发系列》结合风水与现代设计，帮助您把客厅打造成真正的旺气中心。我帮您预留分享会名额？',
 'system','agent',3,'high','active',1000),

('🛋️ 旺沙发分享会 — 确认出席', 'active','sofa_invited_sharing','sofa', 1,'whatsapp_auto',
 '嗨 {name}！《旺沙发分享会》快到了，您能来吗？',
 'system','agent',3,'high','active',1010),

('🛋️ 旺沙发分享会后 — 汇集邀请', 'active','sofa_post_sharing','sofa', 1,'whatsapp_auto',
 '嗨 {name}！分享会后我整理了几款最适合您家空间的旺沙发配置，想在《汇集》上和您详细说明。要来吗？',
 'system','agent',3,'high','active',1020),

('🛋️ 汇集 — 确认出席', 'active','sofa_invited_huiji','sofa', 1,'whatsapp_auto',
 '嗨 {name}！帮您确认《汇集》出席，名额有限！',
 'system','agent',3,'high','warm_hold',1030),

('🛋️ 汇集后 — 方案跟进', 'active','sofa_post_huiji','sofa', 1,'call', NULL,
 'agent','team_leader',3,'high','active',1040),

('🛋️ 方案决定 — 跟进', 'active','sofa_decision','sofa', 3,'whatsapp_auto',
 '嗨 {name}！旺沙发方案您有没有机会考虑一下？有任何问题随时找我。',
 'agent','team_leader',5,'high','active',1050),

-- ════════════════════════════════════════════════════════════════════════════════
-- BUJISHU CURTAIN TRACK (curtain_)
-- ════════════════════════════════════════════════════════════════════════════════

('🪟 感谢CPS — 旺窗帘介绍', 'active','curtain_post_cps','curtain', 1,'whatsapp_auto',
 '嗨 {name}！窗户是室内与外界能量交换的关键通道。我们的《旺窗帘系列》专门优化窗口的能量流入，帮助您把好运和光明引入家中。分享会我帮您留名额？',
 'system','agent',3,'high','active',1100),

('🪟 旺窗帘分享会 — 确认出席', 'active','curtain_invited_sharing','curtain', 1,'whatsapp_auto',
 '嗨 {name}！《旺窗帘分享会》快到了，您能来吗？',
 'system','agent',3,'high','active',1110),

('🪟 旺窗帘分享会后 — 汇集邀请', 'active','curtain_post_sharing','curtain', 1,'whatsapp_auto',
 '嗨 {name}！分享会后特别为您准备了几款适合您家窗向的旺窗帘方案。《汇集》上我们详细聊？',
 'system','agent',3,'high','active',1120),

('🪟 汇集 — 确认出席', 'active','curtain_invited_huiji','curtain', 1,'whatsapp_auto',
 '嗨 {name}！帮您确认《汇集》出席，名额有限！',
 'system','agent',3,'high','warm_hold',1130),

('🪟 汇集后 — 方案跟进', 'active','curtain_post_huiji','curtain', 1,'call', NULL,
 'agent','team_leader',3,'high','active',1140),

('🪟 方案决定 — 跟进', 'active','curtain_decision','curtain', 3,'whatsapp_auto',
 '嗨 {name}！旺窗帘方案您有没有机会考虑一下？有任何问题随时找我。',
 'agent','team_leader',5,'high','active',1150),

-- ════════════════════════════════════════════════════════════════════════════════
-- FORMULA HEALTH CARE TRACK (hc_)
-- ════════════════════════════════════════════════════════════════════════════════

('💊 感谢CPS — 健康产品介绍', 'active','hc_post_cps','hc', 1,'whatsapp_auto',
 '嗨 {name}！改命不只是环境风水，身体的能量状态同样重要！我们的《Formula 健康系列》（鱼油/羊动力/益生菌/护眼素/D3K2）从内部优化您的生命能量。分享会我帮您留位置？',
 'system','agent',3,'high','active',1200),

('💊 CPS健康跟进', 'active','hc_post_cps','hc', 3,'call', NULL,
 'agent','team_leader',3,'high','active',1210),

('💊 福粒分享会 — 确认出席', 'active','hc_invited_sharing','hc', 1,'whatsapp_auto',
 '嗨 {name}！《Formula 健康分享会》就快到了，您能来吗？这次会有真实用户分享使用3-6个月后的身体改变，非常有说服力！',
 'system','agent',3,'high','active',1220),

('💊 福粒分享会 — 提醒', 'active','hc_invited_sharing','hc', 5,'task', NULL,
 'agent','team_leader',3,'med','active',1230),

('💊 福粒分享会后 — 产品跟进', 'active','hc_post_sharing','hc', 1,'whatsapp_auto',
 '嗨 {name}！分享会后您对哪个产品最有兴趣？根据您的体质，我觉得有几款特别适合您。我来帮您分析一下？',
 'system','agent',3,'high','active',1240),

('💊 福粒分享会后 — 新品发布邀请', 'active','hc_post_sharing','hc', 3,'call', NULL,
 'agent','team_leader',3,'high','active',1250),

('💊 新品发布 — 确认出席', 'active','hc_invited_launch','hc', 1,'whatsapp_auto',
 '嗨 {name}！我们的《新品发布活动》就快到了——这次推出的新产品我认为非常适合您！早鸟优惠名额有限，您能来吗？',
 'system','agent',3,'high','active',1260),

('💊 新品发布 — 提醒', 'active','hc_invited_launch','hc', 5,'task', NULL,
 'agent','team_leader',3,'med','active',1270),

('💊 新品发布后 — 会员日邀请', 'active','hc_post_launch','hc', 1,'whatsapp_auto',
 '嗨 {name}！发布会后想到您，我们下个月有《会员日》活动，届时有专属优惠和健康检测服务，非常适合您来了解更多。要来吗？',
 'system','agent',3,'high','active',1280),

('💊 新品发布后 — 跟进', 'active','hc_post_launch','hc', 3,'call', NULL,
 'agent','team_leader',3,'high','active',1290),

('💊 会员日 — 确认出席', 'active','hc_invited_memberday','hc', 1,'whatsapp_auto',
 '嗨 {name}！《会员日》就快到了，我帮您确认出席，有专属体验套装等您！',
 'system','agent',3,'high','warm_hold',1300),

('💊 会员日 — 提醒', 'active','hc_invited_memberday','hc', 5,'task', NULL,
 'agent','team_leader',3,'med','active',1310),

('💊 会员日后 — 产品套装跟进', 'active','hc_post_memberday','hc', 1,'whatsapp_auto',
 '嗨 {name}！会员日您试用的产品感觉怎么样？很多客户第一次试用就感受到能量的提升。我可以帮您了解定期使用方案。',
 'system','agent',3,'high','active',1320),

('💊 会员日后 — 购买决定跟进', 'active','hc_post_memberday','hc', 3,'call', NULL,
 'agent','team_leader',3,'high','active',1330),

('💊 购买决定 — 跟进', 'active','hc_decision','hc', 3,'whatsapp_auto',
 '嗨 {name}！健康产品方案您有没有机会考虑一下？身体是改命旅程最重要的基础，早一天开始就早一天感受改变。',
 'agent','team_leader',5,'high','active',1340),

('💊 购买决定 — TL介入', 'active','hc_decision','hc', 7,'call', NULL,
 'team_leader','manager',5,'high','active',1350),

('💊 购买决定 — 最终确认', 'active','hc_decision','hc',14,'meeting', NULL,
 'team_leader','manager',7,'high','gentle_nurture',1360),

-- ════════════════════════════════════════════════════════════════════════════════
-- POST-PURCHASE 21-STEP JOURNEY  (Steps 5 – 21)
-- Steps 1-4 = pre-purchase funnels above. Steps 5-21 = universal customer journey.
-- days_offset is measured from the purchase/conversion date.
-- ════════════════════════════════════════════════════════════════════════════════

-- Step 5: 黄金大道 — Golden Road meeting (GR activity)
('⭐ Step 5 — 黄金大道欢迎WA', 'active','step05_golden_path','all', 1,'whatsapp_auto',
 '🎉 恭喜 {name}！欢迎正式加入改命大家庭！您的改命旅程今天正式开始。我们的《黄金大道》系统会陪伴您走完接下来的每一步。期待和您共同见证您的人生改变！',
 'system','agent',3,'high','active',2000),

('⭐ Step 5 — 黄金大道首次会面', 'active','step05_golden_path','all', 7,'meeting', NULL,
 'agent','team_leader',5,'high','active',2010),

('⭐ Step 5 — 首月跟进', 'active','step05_golden_path','all',30,'call', NULL,
 'agent','team_leader',7,'med','active',2020),

-- Step 6: 感恩交流 — Customer exchange / gratitude sharing
('🙏 Step 6 — 感恩交流活动邀请', 'active','step06_exchange','all', 0,'whatsapp_auto',
 '嗨 {name}！是时候参加我们的《感恩交流会》了！这是一个让您和其他改命成功的朋友互相分享、互相激励的场合。带上您的改变故事吧！',
 'system','agent',5,'high','active',2100),

('🙏 Step 6 — 感恩交流跟进', 'active','step06_exchange','all', 7,'task', NULL,
 'agent','team_leader',5,'med','active',2110),

-- Step 7: 传福 — Spread blessings
('✨ Step 7 — 传福分享会邀请', 'active','step07_spread','all', 0,'whatsapp_auto',
 '嗨 {name}！您的改命之旅已经走到了一个重要里程碑！现在是时候把这份福分传递给您身边有需要的人。参加《传福活动》，学习如何用您的亲身经历帮助别人！',
 'system','agent',5,'high','active',2200),

('✨ Step 7 — 传福跟进', 'active','step07_spread','all', 7,'task', NULL,
 'agent','team_leader',5,'med','active',2210),

-- Step 8: 见证 — Testimony recording
('📖 Step 8 — 见证录制邀请', 'active','step08_testimony','all', 0,'whatsapp_auto',
 '嗨 {name}！您的改变故事非常有力量！我们想记录下来，不只是为了您自己，更是为了帮助那些还在犹豫改变的人。愿意分享您的见证吗？',
 'system','agent',5,'high','active',2300),

('📖 Step 8 — 见证录制安排', 'active','step08_testimony','all', 7,'meeting', NULL,
 'agent','team_leader',7,'high','active',2310),

-- Step 9: 转介绍 — Referral
('🤝 Step 9 — 转介绍分享', 'active','step09_intro','all', 0,'whatsapp_auto',
 '嗨 {name}！您身边有没有需要改命帮助的朋友或家人？您的推荐是我们最有力的背书，也是给他们最真实的礼物。我们会用同样的专业服务好好照顾他们！',
 'system','agent',5,'med','active',2400),

('🤝 Step 9 — 转介绍跟进', 'active','step09_intro','all',14,'task', NULL,
 'agent','team_leader',5,'med','active',2410),

-- Step 10: 准大使候选 — Ambassador candidate preparation
('🌟 Step 10 — 准大使候选培训', 'active','step10_ambassador_cand','all', 0,'meeting', NULL,
 'team_leader','manager',7,'high','active',2500),

('🌟 Step 10 — 候选评估跟进', 'active','step10_ambassador_cand','all',14,'task', NULL,
 'team_leader','manager',7,'high','active',2510),

-- Step 11: 准传福大使 (L14) — Ambassador path officially starts
('🏅 Step 11 — 准传福大使确认WA', 'active','step11_ambassador_path','all', 0,'whatsapp_auto',
 '🎊 恭喜 {name} 正式晋升为《准传福大使》！这是您在改命旅程中一个非常重要的角色认证。我们会给您提供全面的培训和支持，帮助您带领更多人走上改命之路！',
 'system','manager',3,'high','active',2600),

('🏅 Step 11 — 准大使首次培训', 'active','step11_ambassador_path','all', 7,'meeting', NULL,
 'manager','manager',7,'high','active',2610),

-- Step 12: 小组分享 — Lead a group sharing session
('📣 Step 12 — 小组分享安排', 'active','step12_group_sharing','all', 0,'meeting', NULL,
 'team_leader','manager',7,'high','active',2700),

('📣 Step 12 — 分享会后跟进', 'active','step12_group_sharing','all',14,'task', NULL,
 'team_leader','manager',7,'high','active',2710),

-- Step 13: 传福大使 (L12) confirmed
('🏆 Step 13 — 传福大使正式认证WA', 'active','step13_ambassador','all', 0,'whatsapp_auto',
 '🎉🎉 恭喜 {name} 正式成为《传福大使》！这是我们改命大家庭里最高的荣誉之一。您的领导力和影响力将帮助更多人改变命运。我们为您骄傲！',
 'system','manager',3,'high','active',2800),

('🏆 Step 13 — 大使庆典安排', 'active','step13_ambassador','all', 7,'meeting', NULL,
 'manager','manager',7,'high','active',2810),

-- Step 14: 3-Year Blueprint — Annual 1-to-1 deep review
('📋 Step 14 — 3年蓝图1对1约谈', 'active','step14_blueprint','all', 0,'meeting', NULL,
 'agent','team_leader',7,'high','active',2900),

('📋 Step 14 — 3年蓝图WA提醒', 'active','step14_blueprint','all', 0,'whatsapp_auto',
 '嗨 {name}！是时候做您的《3年改命蓝图》回顾了！我们会一起检视过去的进展，调整未来3年的能量布局方向。这是每年最重要的一次1对1会谈。我帮您预约时间？',
 'system','agent',3,'high','active',2910),

-- Step 15: 第二产品 — New product recommendation
('💡 Step 15 — 第二产品建议', 'active','step15_new_product','all', 0,'meeting', NULL,
 'agent','team_leader',7,'high','active',3000),

('💡 Step 15 — 新产品介绍WA', 'active','step15_new_product','all', 7,'whatsapp_auto',
 '嗨 {name}！在您的改命旅程走到这一步，我想和您分享一个能进一步提升能量的产品。根据您目前的状态，我觉得非常适合您。有时间聊聊吗？',
 'agent','team_leader',7,'med','active',3010),

-- Step 16: 多产品 — Multi-product holder
('🌐 Step 16 — 多产品组合规划', 'active','step16_multi_product','all', 0,'meeting', NULL,
 'team_leader','manager',7,'high','active',3100),

('🌐 Step 16 — 能量组合评估', 'active','step16_multi_product','all',30,'task', NULL,
 'team_leader','manager',7,'med','active',3110),

-- Step 17: DC 招商会 — DC Business Meetup
('🏢 Step 17 — DC招商会邀请', 'active','step17_dc_meetup','all', 0,'whatsapp_auto',
 '嗨 {name}！诚邀您出席即将举行的《DC招商会》。这是一个高端商业交流平台，集合了我们改命大家庭里的成功商业伙伴。您的参与将为您带来宝贵的人脉和商业机遇！',
 'system','manager',3,'high','active',3200),

('🏢 Step 17 — DC招商会跟进', 'active','step17_dc_meetup','all', 7,'meeting', NULL,
 'manager','manager',7,'high','active',3210),

-- Step 18: 高阶培训 — Advanced training
('🎓 Step 18 — 高阶培训邀请', 'active','step18_advanced','all', 0,'meeting', NULL,
 'manager','manager',7,'high','active',3300),

('🎓 Step 18 — 培训后评估', 'active','step18_advanced','all',14,'task', NULL,
 'manager','manager',7,'high','active',3310),

-- Step 19: 案例贡献 — Case study contribution
('📚 Step 19 — 案例贡献邀请', 'active','step19_case_study','all', 0,'meeting', NULL,
 'manager','manager',7,'high','active',3400),

('📚 Step 19 — 案例整理跟进', 'active','step19_case_study','all',14,'task', NULL,
 'manager','manager',7,'med','active',3410),

-- Step 20: 领导团队 — Leadership team
('👑 Step 20 — 领导团队邀请', 'active','step20_leadership','all', 0,'meeting', NULL,
 'manager','manager',7,'high','active',3500),

('👑 Step 20 — 领导力培训', 'active','step20_leadership','all',30,'meeting', NULL,
 'manager','manager',7,'high','active',3510),

-- Step 21: 三年成就 — 3-Year Legacy Achievement
('🌟 Step 21 — 三年成就庆典', 'active','step21_legacy','all', 0,'meeting', NULL,
 'manager','manager',7,'high','active',3600),

('🌟 Step 21 — 成就WA祝贺', 'active','step21_legacy','all', 0,'whatsapp_auto',
 '🎊🎊🎊 {name}，您做到了！三年的改命旅程走到了最圆满的里程碑。您的坚持和成长是对所有人最大的激励！感恩有您！💫',
 'system','manager',3,'high','active',3610),

-- ════════════════════════════════════════════════════════════════════════════════
-- ANNUAL TOUCHPOINTS  (for all active customers — spawned annually by admin/cron)
-- ════════════════════════════════════════════════════════════════════════════════

-- Flying Stars (3/5/7 — MG-based, 3× per year)
('年度飞星3 — 三碧星提醒WA', 'annual','annual_flying_stars','all', 0,'whatsapp_auto',
 '嗨 {name}！今年【三碧星】入宫，特别提醒：东方位置容易出现口舌是非，建议摆放化解摆件。我们为您准备了专属飞星海报，请查收！如需进一步个人化分析，随时联系我 🙏',
 'system','agent',7,'low','warm_hold',4000),

('年度飞星5 — 五黄星提醒WA', 'annual','annual_flying_stars','all', 0,'whatsapp_auto',
 '嗨 {name}！今年【五黄星】位置需要特别注意！这是最强的凶星，影响所及的方位务必做化解处理。专属海报和化解建议已为您准备好，有需要可以约时间细聊！',
 'system','agent',7,'low','warm_hold',4010),

('年度飞星7 — 七赤星提醒WA', 'annual','annual_flying_stars','all', 0,'whatsapp_auto',
 '嗨 {name}！今年【七赤星】入宫，带来的影响以破财和盗劫为主。我们为您准备了专属的七赤星化解指南和海报！如需为您的居家做针对性布局调整，随时联系我 🌟',
 'system','agent',7,'low','warm_hold',4020),

-- Birthday
('年度生日祝福WA', 'annual','annual_birthday','all', 0,'whatsapp_auto',
 '🎂 {name}，生日快乐！愿您今年身体健康、事业顺遂、万事如意！在您人生新的一年里，祝愿您的改命旅程更上一层楼！🌟',
 'system','agent',7,'med','warm_hold',4100),

-- 立春
('年度立春祝福WA', 'annual','annual_spring','all', 0,'whatsapp_auto',
 '嗨 {name}！【立春】到了，万象更新！新的能量周期正式开始，是调整家居风水布局的最佳时机。如需为您分析今年的运势方向，随时找我！祝新春吉祥、万事顺利 🌱',
 'system','agent',7,'low','warm_hold',4200),

-- Mid-year check
('年度中年检视任务', 'annual','annual_midyear','all', 0,'task', NULL,
 'agent','team_leader',14,'low','warm_hold',4300),

-- 冬至
('年度冬至祝福WA', 'annual','annual_dongzhi','all', 0,'whatsapp_auto',
 '嗨 {name}！【冬至】到了，这是一年中最重要的能量转折点！冬至之后阳气回升，正是重新调整能量布局的好时机。祝您冬至快乐，阖家团圆！🌙',
 'system','agent',7,'low','warm_hold',4400),

-- 运程讲座 (annual forecast lecture — Nov/Dec)
('年度运程讲座邀请WA', 'annual','annual_forecast','all', 0,'whatsapp_auto',
 '嗨 {name}！我们一年一度的《运程讲座》就快到了！届时资深老师会分析明年的整体运势趋势，以及每个命格需要特别注意的方向。这是我们每年最受期待的活动！我帮您保留名额？',
 'system','agent',7,'med','warm_hold',4500),

('年度运程讲座跟进任务', 'annual','annual_forecast','all', 3,'task', NULL,
 'agent','team_leader',7,'med','warm_hold',4510),

-- 星卦解运 1-to-1 (personal 12-month analysis after forecast lecture)
('年度星卦解运 — 1对1预约WA', 'annual','annual_xingua','all', 0,'whatsapp_auto',
 '嗨 {name}！运程讲座后，很多朋友都问我可否做个人化的《星卦解运》分析。这是一个专门为您解析明年12个月每月运势走向的1对1服务。名额非常有限——您想预约吗？',
 'system','agent',3,'high','active',4600),

('年度星卦解运 — 预约确认', 'annual','annual_xingua','all', 3,'meeting', NULL,
 'agent','team_leader',5,'high','active',4610)

ON CONFLICT DO NOTHING;

-- ── 5. Update existing conditional rules + add new ones ───────────────────────

-- Remove old default rules to re-insert with correct config
DELETE FROM public.conditional_rules WHERE trigger_event IN
    ('said_not_now','no_reply_90d','score_above_70','nurture_score_50');

INSERT INTO public.conditional_rules
    (trigger_event, trigger_value, action, action_payload, is_active)
VALUES

-- ── Keep original 4 (updated) ─────────────────────────────────────────────────
('said_not_now',      '{}', 'move_to_nurture', '{"track":"nurture"}',                              true),
('no_reply_90d',      '{}', 'pause',           '{}',                                               true),
('score_above_70',    '{}', 'accelerate',      '{"reduce_offset_days":7}',                         true),
('nurture_score_50',  '{}', 'move_to_active',  '{"stage":"pr_post_cps"}',                          true),

-- ── No-reply mode escalations ─────────────────────────────────────────────────
('no_reply_21d_active',  '{}', 'move_to_nurture',  '{"track":"nurture","from_mode":"active"}',     true),
('no_reply_45d_nurture', '{}', 'pause',             '{}',                                          true),

-- ── Score escalation ──────────────────────────────────────────────────────────
('score_above_80',    '{}', 'escalate', '{"notify":"team_leader","reason":"High engagement score — review for fast-track"}', true),

-- ── CPS interest detection → spawn product track ─────────────────────────────
('cps_interest_ring',        '{}', 'skip_to_stage', '{"stage":"pr_post_cps",       "product_track":"pr"}',      true),
('cps_interest_fengshui',    '{}', 'skip_to_stage', '{"stage":"fs_post_cps",       "product_track":"fs"}',      true),
('cps_interest_calligraphy', '{}', 'skip_to_stage', '{"stage":"cal_post_cps",      "product_track":"cal"}',     true),
('cps_interest_bed',         '{}', 'skip_to_stage', '{"stage":"bed_post_cps",      "product_track":"bed"}',     true),
('cps_interest_sofa',        '{}', 'skip_to_stage', '{"stage":"sofa_post_cps",     "product_track":"sofa"}',    true),
('cps_interest_curtain',     '{}', 'skip_to_stage', '{"stage":"curtain_post_cps",  "product_track":"curtain"}', true),
('cps_interest_healthcare',  '{}', 'skip_to_stage', '{"stage":"hc_post_cps",       "product_track":"hc"}',      true),

-- ── Power Ring funnel advancement ────────────────────────────────────────────
('pr_9star_class_attended', '{}', 'skip_to_stage', '{"stage":"pr_post_9star",    "product_track":"pr"}', true),
('pr_sharing_attended',     '{}', 'skip_to_stage', '{"stage":"pr_post_sharing",  "product_track":"pr"}', true),
('pr_museum_attended',      '{}', 'skip_to_stage', '{"stage":"pr_post_museum",   "product_track":"pr"}', true),
('pr_huiji_attended',       '{}', 'skip_to_stage', '{"stage":"pr_post_huiji",    "product_track":"pr"}', true),
('pr_fsa_completed',        '{}', 'skip_to_stage', '{"stage":"pr_decision",      "product_track":"pr"}', true),

-- ── Feng Shui Audit funnel advancement ───────────────────────────────────────
('fs_diy_attended',         '{}', 'skip_to_stage', '{"stage":"fs_post_diy",      "product_track":"fs"}', true),
('fs_sharing_attended',     '{}', 'skip_to_stage', '{"stage":"fs_post_sharing",  "product_track":"fs"}', true),
('fs_museum_attended',      '{}', 'skip_to_stage', '{"stage":"fs_post_museum",   "product_track":"fs"}', true),
('fs_huiji_attended',       '{}', 'skip_to_stage', '{"stage":"fs_post_huiji",    "product_track":"fs"}', true),
('fs_fsa_completed',        '{}', 'skip_to_stage', '{"stage":"fs_decision",      "product_track":"fs"}', true),

-- ── Calligraphy funnel advancement ────────────────────────────────────────────
('cal_sharing_attended',    '{}', 'skip_to_stage', '{"stage":"cal_post_sharing", "product_track":"cal"}', true),
('cal_art_attended',        '{}', 'skip_to_stage', '{"stage":"cal_post_art",     "product_track":"cal"}', true),
('cal_huiji_attended',      '{}', 'skip_to_stage', '{"stage":"cal_post_huiji",   "product_track":"cal"}', true),

-- ── Bujishu funnel advancement ────────────────────────────────────────────────
('bed_sharing_attended',     '{}', 'skip_to_stage', '{"stage":"bed_post_sharing",     "product_track":"bed"}',     true),
('bed_huiji_attended',       '{}', 'skip_to_stage', '{"stage":"bed_post_huiji",       "product_track":"bed"}',     true),
('sofa_sharing_attended',    '{}', 'skip_to_stage', '{"stage":"sofa_post_sharing",    "product_track":"sofa"}',    true),
('sofa_huiji_attended',      '{}', 'skip_to_stage', '{"stage":"sofa_post_huiji",      "product_track":"sofa"}',    true),
('curtain_sharing_attended', '{}', 'skip_to_stage', '{"stage":"curtain_post_sharing", "product_track":"curtain"}', true),
('curtain_huiji_attended',   '{}', 'skip_to_stage', '{"stage":"curtain_post_huiji",   "product_track":"curtain"}', true),

-- ── Health Care funnel advancement ────────────────────────────────────────────
('hc_sharing_attended',     '{}', 'skip_to_stage', '{"stage":"hc_post_sharing",    "product_track":"hc"}', true),
('hc_launch_attended',      '{}', 'skip_to_stage', '{"stage":"hc_post_launch",     "product_track":"hc"}', true),
('hc_memberday_attended',   '{}', 'skip_to_stage', '{"stage":"hc_post_memberday",  "product_track":"hc"}', true),

-- ── Purchase → Step 5 + Role Upgrade ─────────────────────────────────────────
('purchase_signed', '{}', 'skip_to_stage',
 '{"stage":"step05_golden_path","product_track":"all","clear_pre_purchase":true}', true),

('purchase_signed_role', '{}', 'role_upgrade',
 '{"role_level":13,"role_name":"改命客户","notify_agent":true}', true),

-- ── Post-purchase progression ─────────────────────────────────────────────────
('gr_activity_logged',       '{}', 'skip_to_stage', '{"stage":"step06_exchange"}',        true),
('testimony_recorded',       '{}', 'skip_to_stage', '{"stage":"step08_testimony"}',       true),
('referral_intro_given',     '{}', 'skip_to_stage', '{"stage":"step09_intro"}',           true),
('ambassador_nominated',     '{}', 'skip_to_stage', '{"stage":"step11_ambassador_path"}', true),
('ambassador_nominated_role','{}', 'role_upgrade',   '{"role_level":14,"role_name":"准传福大使","notify_agent":true}', true),
('ambassador_confirmed',     '{}', 'skip_to_stage', '{"stage":"step13_ambassador"}',      true),
('ambassador_confirmed_role','{}', 'role_upgrade',   '{"role_level":12,"role_name":"传福大使","notify_agent":true}',  true),
('dc_meetup_attended',       '{}', 'skip_to_stage', '{"stage":"step17_dc_meetup"}',       true)

ON CONFLICT DO NOTHING;

-- ── 6. Sanity summary view ────────────────────────────────────────────────────
-- Quick count to verify migration ran correctly:
-- SELECT product_track, COUNT(*) FROM journey_templates GROUP BY product_track ORDER BY product_track;
-- SELECT action, COUNT(*) FROM conditional_rules GROUP BY action ORDER BY action;
