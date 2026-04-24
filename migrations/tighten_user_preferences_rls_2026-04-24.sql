-- =====================================================================
-- Tighten user_preferences RLS — per-user read only
-- 2026-04-24
--
-- See migrations/rls_review_2026-04-24.md for the full audit context.
-- This is the one table out of the 16 where cross-user SELECT is not
-- needed; every user only ever reads their own row.
-- =====================================================================

begin;

drop policy if exists "auth_select" on user_preferences;

create policy "auth_select_self" on user_preferences
  for select to authenticated
  using (user_id::text = auth.uid()::text);

-- Keep insert/update/delete behaviour consistent with the rest of the
-- replace_allow_all migration (mgr/admin gated). user_preferences is
-- normally written by the user themselves, so allow self-write here too.
drop policy if exists "auth_insert" on user_preferences;
create policy "auth_insert_self" on user_preferences
  for insert to authenticated
  with check (user_id::text = auth.uid()::text);

drop policy if exists "mgr_update" on user_preferences;
create policy "self_update" on user_preferences
  for update to authenticated
  using      (user_id::text = auth.uid()::text)
  with check (user_id::text = auth.uid()::text);

commit;
