-- Rollback for migrations/2026-11-05_name_list_feedback.sql.
-- 1. Run this file. 2. Re-run the name_list_get section of
--    migrations/2026-11-05_name_lists_who.sql (rows without notes).
-- ⚠ Dropping the table loses every "Not right?" / "why missed" note.
drop function if exists public.name_list_feedback_report();
drop function if exists public.name_list_feedback(bigint, text, text, boolean);
drop trigger if exists name_list_feedback_guard on public.name_list_feedback;
drop table if exists public.name_list_feedback;
drop function if exists public.nl_feedback_guard();
drop function if exists public.nl_fb_label(text);
