-- Rollback of migrations/2026-11-01_cps_cancel.sql. Afterwards re-run sections
-- 1–3 of migrations/2026-11-01_new_friends.sql to restore the earlier list rule
-- (not section 4: the invite label is already changed). Cancelled CPS rows stay
-- deleted; this drops their history.
drop function if exists public.cps_cancel(bigint, text, text);
drop function if exists public.new_friend_list();
drop function if exists public.nf_rows(date);
drop function if exists public.cps_reason_label(text);
drop table if exists public.cps_cancellations;
alter table public.prospects drop column if exists cps_cancelled_on;
