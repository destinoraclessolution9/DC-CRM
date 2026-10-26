-- Post-CPS 九星课 WhatsApp (2026-10-26): the owner's own wording replaces
-- the paused draft, and the step is switched back on (sent 1 day after CPS).
update public.journey_templates
   set message_template = $msg$《九星》知识讲座

九星，是个人风水的重要基础。

🌠 天上星，🏞 地下卦
🌟🌟 九星系情，强弱有别 🌟🌟
💫✨ 星星相连，心心相吸 ✨💫

每颗星，都在牵引我们一辈子的遭遇与结果。

哪一颗星与你相连？你了解先天的哪颗星，造就了现在的你吗？

这堂课，让你看清自己的优弱点——把优点发挥到淋漓尽致，提升人生价值。

我们一起来探讨「星心」⭐❤

确认出席请让我知道，我帮您报名。$msg$,
       is_active = true
 where id = 1;
