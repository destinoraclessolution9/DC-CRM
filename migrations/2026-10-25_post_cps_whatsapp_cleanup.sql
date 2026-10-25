-- Post-CPS WhatsApps (2026-10-25, owner): the CPS is a free consultation WE
-- give — the customer thanks us, not the other way round. So:
--   * the 5 product-line "感谢CPS" WhatsApps nobody ever received (画作 / 旺床 /
--     旺沙发 / 旺窗帘 / 健康) are deleted (owner: "the rest delete it");
--   * the two kept ones (💍 九星课, 🏠 风水DIY) lose the 感谢 title and are
--     PAUSED until the owner's own wording replaces the old text;
--   * the 11 open ring WhatsApps still carrying the old "很开心今天和您聊了…"
--     text are skipped (the 3-day CPS follow-up call stays).
-- Restore the deleted rows with:
--   insert into public.journey_templates select * from json_populate_recordset(null::public.journey_templates, '<backup json below>');

delete from public.journey_templates
 where id in (47, 64, 71, 77, 83)
   and not exists (select 1 from public.journey_touchpoints t where t.template_id in (47, 64, 71, 77, 83));

update public.journey_templates set name = '💍 CPS后 — 九星课介绍', is_active = false where id = 1;
update public.journey_templates set name = '🏠 CPS后 — 风水DIY课介绍', is_active = false where id = 24;

update public.journey_touchpoints
   set status = 'skipped', updated_at = now(),
       notes = coalesce(notes || ' · ', '') || 'skipped 2026-10-25: old 感谢CPS wording retired by owner'
 where template_id = 1 and status in ('pending', 'overdue', 'snoozed');

-- backup of the 5 deleted rows:
-- [{"id": 47, "name": "🖌️ 感谢CPS — 画作介绍", "track": "active", "stage_name": "cal_post_cps", "days_offset": 1, "touchpoint_type": "whatsapp_auto", "message_template": "嗨 {name}！今天聊到您对风水画作的兴趣！每幅画作都有特定的能量寓意，挂在正确位置能激活居家或办公室的旺气。我们的《画作分享会》会详细介绍。我帮您留位置？", "assigned_to_role": "system", "escalates_to_role": "agent", "escalate_after_days": 3, "priority": "high", "is_active": true, "sort_order": 700, "created_at": "2026-06-09T07:16:47.786711+00:00", "product_track": "cal", "follow_mode": "active"}, {"id": 64, "name": "🛏️ 感谢CPS — 旺床介绍", "track": "active", "stage_name": "bed_post_cps", "days_offset": 1, "touchpoint_type": "whatsapp_auto", "message_template": "嗨 {name}！睡眠方向是风水里影响最直接的因素之一。我们的《旺床/满堂系列》专门针对卧室能量优化——很多客户改变床向后睡眠质量和运气都明显改善。分享会我帮您留位？", "assigned_to_role": "system", "escalates_to_role": "agent", "escalate_after_days": 3, "priority": "high", "is_active": true, "sort_order": 900, "created_at": "2026-06-09T07:16:47.786711+00:00", "product_track": "bed", "follow_mode": "active"}, {"id": 71, "name": "🛋️ 感谢CPS — 旺沙发介绍", "track": "active", "stage_name": "sofa_post_cps", "days_offset": 1, "touchpoint_type": "whatsapp_auto", "message_template": "嗨 {name}！客厅是家里凝聚能量最重要的空间。我们的《旺沙发系列》结合风水与现代设计，帮助您把客厅打造成真正的旺气中心。我帮您预留分享会名额？", "assigned_to_role": "system", "escalates_to_role": "agent", "escalate_after_days": 3, "priority": "high", "is_active": true, "sort_order": 1000, "created_at": "2026-06-09T07:16:47.786711+00:00", "product_track": "sofa", "follow_mode": "active"}, {"id": 77, "name": "🪟 感谢CPS — 旺窗帘介绍", "track": "active", "stage_name": "curtain_post_cps", "days_offset": 1, "touchpoint_type": "whatsapp_auto", "message_template": "嗨 {name}！窗户是室内与外界能量交换的关键通道。我们的《旺窗帘系列》专门优化窗口的能量流入，帮助您把好运和光明引入家中。分享会我帮您留名额？", "assigned_to_role": "system", "escalates_to_role": "agent", "escalate_after_days": 3, "priority": "high", "is_active": true, "sort_order": 1100, "created_at": "2026-06-09T07:16:47.786711+00:00", "product_track": "curtain", "follow_mode": "active"}, {"id": 83, "name": "💊 感谢CPS — 健康产品介绍", "track": "active", "stage_name": "hc_post_cps", "days_offset": 1, "touchpoint_type": "whatsapp_auto", "message_template": "嗨 {name}！改命不只是环境风水，身体的能量状态同样重要！我们的《Formula 健康系列》（鱼油/羊动力/益生菌/护眼素/D3K2）从内部优化您的生命能量。分享会我帮您留位置？", "assigned_to_role": "system", "escalates_to_role": "agent", "escalate_after_days": 3, "priority": "high", "is_active": true, "sort_order": 1200, "created_at": "2026-06-09T07:16:47.786711+00:00", "product_track": "hc", "follow_mode": "active"}]
