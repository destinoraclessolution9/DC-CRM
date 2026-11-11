-- UNDO for 2026-11-11_office_ready_notices.sql — removes the office notices
-- feature. ⚠ Drops the notice photos' DB records and the item step columns
-- (the photos themselves stay in the attachments bucket under office-notices/).
-- Run only with the owner's OK.
drop function if exists public.office_notice_apply(bigint, jsonb);
drop function if exists public.office_notice_candidates(bigint);
alter table public.delivery_items drop column if exists office_notice_id;
alter table public.delivery_items drop column if exists office_ready_date;
alter table public.delivery_items drop column if exists office_ready_place;
alter table public.delivery_items drop column if exists collected_at;
alter table public.delivery_items drop column if exists collected_by;
alter table public.delivery_items drop column if exists customer_told_at;
alter table public.delivery_items drop column if exists customer_told_by;
drop table if exists public.office_notice_lines;
drop table if exists public.office_notices;
drop function if exists public.office_notice_lines_norm();
drop function if exists public.office_notices_touch();
drop function if exists public.office_sn_norm(text);
