-- ============================================================================
--  RLS per-row SELECT scoping — APPLIED to production 2026-06-18
-- ============================================================================
--  Applied live via the Supabase SQL editor (project remuwhxvzkzjtgbzqjaa) after
--  a full impersonation pre-flight. Closes BACK-1: previously `auth_full_access`
--  (FOR ALL, USING true) let any authenticated user SELECT every row in
--  prospects/customers/activities via PostgREST. Now SELECT is per-row scoped;
--  INSERT/UPDATE/DELETE behavior is preserved (auth_write_* re-grants).
--
--  This is the EXACT statement that was committed (VARIANT A from the DRAFT +
--  the A7 orphan-visibility clause, which the pre-flight proved necessary: 15
--  customers / 1 prospect / 1 activity have NULL owners and would otherwise be
--  invisible even to admins).
--
--  VERIFIED LIVE (set role authenticated + impersonated JWT):
--    Super Admin (id 9999): prospects 614/614, customers 30/30, activities 165/165 (all)
--    Agent L10 (id 1775485433296): prospects 4, customers 0, activities 25 (own only)
--  Helpers present: current_user_level / current_user_row_id / current_user_visible_ids.
--  auth_user_id backfill: 21/22 active users linked; the 1 unlinked (id 2
--  Marketing Manager) has NO auth account → cannot log in → cannot be locked out
--  (owner confirmed it's a dormant placeholder).
-- ============================================================================

begin;
alter table public.activities enable row level security;
alter table public.prospects  enable row level security;
alter table public.customers  enable row level security;

drop policy if exists "activities_scoped_select" on public.activities;
create policy "activities_scoped_select" on public.activities for select to authenticated using (
  lead_agent_id in (select current_user_visible_ids())
  or lead_agent_id = current_user_row_id()
  or co_agents @> jsonb_build_array(jsonb_build_object('id', current_user_row_id()))
  or visibility in ('open','public')
  or (lead_agent_id is null and coalesce(current_user_level(),99) <= 2)
);

drop policy if exists "prospects_scoped_select" on public.prospects;
create policy "prospects_scoped_select" on public.prospects for select to authenticated using (
  responsible_agent_id in (select current_user_visible_ids())
  or cps_agent_id in (select current_user_visible_ids())
  or lead_agent_id in (select current_user_visible_ids())
  or responsible_agent_id = current_user_row_id()
  or cps_agent_id = current_user_row_id()
  or lead_agent_id = current_user_row_id()
  or (responsible_agent_id is null and cps_agent_id is null and lead_agent_id is null and coalesce(current_user_level(),99) <= 2)
);

drop policy if exists "customers_scoped_select" on public.customers;
create policy "customers_scoped_select" on public.customers for select to authenticated using (
  responsible_agent_id in (select current_user_visible_ids())
  or responsible_agent_id = current_user_row_id()
  or (responsible_agent_id is null and coalesce(current_user_level(),99) <= 2)
);

-- Retire the permissive FOR ALL policy; preserve writes (USING/CHECK true).
drop policy if exists "auth_full_access" on public.activities;
create policy "auth_write_insert" on public.activities for insert to authenticated with check (true);
create policy "auth_write_update" on public.activities for update to authenticated using (true) with check (true);
create policy "auth_write_delete" on public.activities for delete to authenticated using (true);

drop policy if exists "auth_full_access" on public.prospects;
create policy "auth_write_insert" on public.prospects for insert to authenticated with check (true);
create policy "auth_write_update" on public.prospects for update to authenticated using (true) with check (true);
create policy "auth_write_delete" on public.prospects for delete to authenticated using (true);

drop policy if exists "auth_full_access" on public.customers;
create policy "auth_write_insert" on public.customers for insert to authenticated with check (true);
create policy "auth_write_update" on public.customers for update to authenticated using (true) with check (true);
create policy "auth_write_delete" on public.customers for delete to authenticated using (true);

commit;

-- ============================================================================
--  ROLLBACK (run if the app shows missing data for legit users) — restores the
--  prior wide-open behavior verbatim, instantly.
-- ============================================================================
-- begin;
-- drop policy if exists "activities_scoped_select" on public.activities;
-- drop policy if exists "prospects_scoped_select"  on public.prospects;
-- drop policy if exists "customers_scoped_select"  on public.customers;
-- drop policy if exists "auth_write_insert" on public.activities;
-- drop policy if exists "auth_write_update" on public.activities;
-- drop policy if exists "auth_write_delete" on public.activities;
-- drop policy if exists "auth_write_insert" on public.prospects;
-- drop policy if exists "auth_write_update" on public.prospects;
-- drop policy if exists "auth_write_delete" on public.prospects;
-- drop policy if exists "auth_write_insert" on public.customers;
-- drop policy if exists "auth_write_update" on public.customers;
-- drop policy if exists "auth_write_delete" on public.customers;
-- create policy "auth_full_access" on public.activities for all to authenticated using (true) with check (true);
-- create policy "auth_full_access" on public.prospects  for all to authenticated using (true) with check (true);
-- create policy "auth_full_access" on public.customers  for all to authenticated using (true) with check (true);
-- commit;
--
-- NOTE (write hardening, future): auth_write_* are USING/CHECK true (any
-- authenticated user can INSERT/UPDATE/DELETE any row via the API — unchanged
-- from before). The SELECT leak is fixed; write scoping is a separate follow-up.
-- NOTE (realtime / BACK-4): Supabase Realtime postgres_changes now filters by
-- these SELECT policies, so per-client change broadcasts are scoped automatically.
-- NOTE (Marketing Manager id 2): if it ever becomes a real login, create its
-- auth.users account and set public.users.auth_user_id BEFORE first login.
