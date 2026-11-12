-- Rollback for migrations/2026-11-12_name_lists_owed.sql.
-- 1. Archive or delete any list with who = 'owed' first (the check below refuses them).
-- 2. Run this file.
-- 3. Re-run migrations/2026-11-12_name_lists_waiting.sql sections 4–7 (nl_pool,
--    nl_generate, nl_parse, name_list_preview, name_list_create,
--    name_list_index, name_list_get) to put the waiting-only versions back.
alter table public.name_lists drop constraint if exists name_lists_who_chk;
alter table public.name_lists add constraint name_lists_who_chk
    check (who in ('best', 'owns_1', 'owns_any', 'owns_none', 'waiting'));
drop function if exists public.nl_owed_pieces(text);
