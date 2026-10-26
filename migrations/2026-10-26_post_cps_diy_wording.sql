-- Post-CPS 风水DIY WhatsApp (2026-10-26): the owner's own wording replaces
-- the paused draft, and the step is switched back on (sent 1 day after CPS).
update public.journey_templates
   set message_template = $msg$風水DIY

「風水」兩字，很多人相信，卻不得其法。

DC 過去16年檢閱數以千計的屋宇，總結出風水基礎八招——實用、安全、有效，讓你親自動手，在家DIY風水。

保護好我們的家，從基本做起 🏠

下个星期四晚上8pm開課，我幫您留個位，好嗎？$msg$,
       is_active = true
 where id = 24;
