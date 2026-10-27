-- Owner 2026-10-27: link the typed referrals of three 传福大使 so the board
-- counts them. The agent credit ("Referred By") is kept; the client credit
-- goes into the new introduced_by fields.
--   TAN YOKE WEI ×15 (+ the 3 "Xavier" spellings) → customer Tan Yoke Wei;
--     the "Consultant" rows typed without a link → linked to the agent
--     account of the same name (what the agent picked).
--   LIAW WEI YE ×9 — linked to the agent LIAW WEI DA, text says Aric →
--     introduced by customer LIAW WEI YE (Aric); agent credit unchanged.
--   LIEW CHUN KIN ×8 — typed as Customer, no link → customer Liew Chun Kin.
begin;

update public.prospects
   set introduced_by_type = 'Customer', introduced_by_id = 1782483591567, introduced_by = 'Tan Yoke Wei', updated_at = now()
 where referred_by_id is null and introduced_by_id is null
   and upper(btrim(referred_by)) in ('TAN YOKE WEI', 'TAN YOKE WEI (XAVIER)', 'XAVIER TAN YOKE WEI', 'XAVIER TAN');

update public.prospects
   set referred_by_id = 1782721410358, referred_by = 'Tan Yoke Wei', updated_at = now()
 where referred_by_id is null and referred_by_type = 'Consultant'
   and upper(btrim(referred_by)) in ('TAN YOKE WEI', 'TAN YOKE WEI (XAVIER)', 'XAVIER TAN YOKE WEI');

update public.prospects
   set introduced_by_type = 'Customer', introduced_by_id = 1782483588657, introduced_by = 'LIAW WEI YE', updated_at = now()
 where introduced_by_id is null and btrim(referred_by) = 'LIAW WEI YE'
   and referred_by_type = 'Consultant' and referred_by_id = 1775471199754;

update public.prospects
   set referred_by_id = 1780712000037, referred_by = 'Liew Chun Kin', updated_at = now()
 where referred_by_id is null and referred_by_type = 'Customer' and upper(btrim(referred_by)) = 'LIEW CHUN KIN';

commit;
