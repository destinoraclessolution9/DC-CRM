-- Rollback for migrations/2026-11-12_name_lists_waiting.sql.
-- 1. Archive or delete any list with who = 'waiting' first (the check below refuses them).
-- 2. Run this file.
-- 3. Re-run migrations/2026-11-05_name_lists_who.sql sections 3–6 (nl_line_sales,
--    the 8-argument nl_pool, nl_generate, nl_parse, name_list_preview,
--    name_list_create, name_list_set, name_list_index), then the name_list_get
--    section of migrations/2026-11-05_name_list_feedback.sql.
drop function if exists public.nl_pool(bigint, text, text, text, jsonb, text, date, date, text);
drop function if exists public.nl_pending_pieces(text);
alter table public.name_lists drop constraint if exists name_lists_stage_chk;
alter table public.name_lists drop constraint if exists name_lists_who_chk;
alter table public.name_lists add constraint name_lists_who_chk check (who in ('best', 'owns_1', 'owns_any', 'owns_none'));
alter table public.name_lists drop column if exists stage;
-- nl_item_text is left in place: the re-run nl_line_sales does not use it.
