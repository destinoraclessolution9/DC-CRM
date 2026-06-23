-- =====================================================================
-- FIX: customer/prospect/report visibility leak — "leader sees the WHOLE
-- company's customers instead of own + their team".
-- Date: 2026-06-22
--
-- ROOT CAUSE (confirmed in code, not a scoping-logic bug):
--   The live visibility scope is computed server-side by bff_visible_agent_ids()
--   (api/customers.mjs + api/prospects.mjs + every report RPC), which keys off
--   the AUTHORITATIVE users.role_level column:
--       role_level <= 2  -> sees EVERYONE        (super admin / marketing mgr)
--       role_level 3..11 -> own + downline team  (leaders / agents)
--       role_level >= 12 -> own records only
--   role_level was backfilled ONCE (role_level_2026-06-14.sql) but the app NEVER
--   writes it again: saveAgent() (and the create path) write the `role` STRING
--   only. So whenever an account's role is changed in the UI, role_level goes
--   STALE and diverges from the role string. An account whose role_level is left
--   at an admin value (1/2) is treated as "see everyone" regardless of its real
--   role string — exactly what was observed (a Team Leader seeing the whole
--   company's customers, including unassigned/null-agent rows).
--
--   This is the SAME class of bug already documented in
--   fude_admin_roles_TEMPLATE_2026-06-17.sql (admins under-privileged because
--   their role_level was unset/stale) — here it bites in the opposite direction.
--
-- FIX (DB-only; the scoping code is already correct):
--   (1) _role_to_level(role) — server mirror of the client's _getUserLevel()
--       parse, clamped to the CHECK range 1..15, unknown -> 12 (own-only).
--   (2) One-time backfill: re-derive role_level from the role string for every
--       row where they currently diverge (fixes the reported account + any other
--       silently-stale ones).
--   (3) Trigger users_sync_role_level — keeps role_level a server-derived mirror
--       of `role` on EVERY future insert/update, from ANY path (UI, import,
--       recruit, approvals, edge funcs). Kills the divergence class for good.
--
-- SAFETY / ordering:
--   The trigger name sorts AFTER "users_guard" (g < s), so the existing
--   role-escalation guard (sec_2026-06-19_writes.sql) still evaluates the
--   client-submitted old/new values FIRST and is unaffected; this trigger then
--   corrects role_level. After the backfill all rows are consistent, so on an
--   unrelated edit (e.g. phone) the trigger is a no-op. A non-admin still cannot
--   change `role` (guard blocks it), so they cannot influence role_level either.
--   Additive DDL + one idempotent UPDATE. No reload storm; takes effect for all
--   clients immediately via the BFF RPC. Re-runnable.
-- =====================================================================

begin;

-- (1) Canonical role-string -> numeric level (mirrors _getUserLevel in script.js).
--     IMMUTABLE + clamped to 1..15 so a malformed role can never violate the
--     users_role_level_range CHECK and break a users write.
create or replace function public._role_to_level(p_role text)
returns smallint
language sql
immutable
set search_path = public, pg_temp
as $$
  select least(15, greatest(1, coalesce(
    -- "Level N ..." prefix covers all 11 standard tiers
    nullif(substring(coalesce(p_role, '') from 'Level\s+(\d+)'), '')::int,
    case lower(btrim(coalesce(p_role, '')))
      when 'super_admin'       then 1
      when 'admin'             then 1
      when 'marketing_manager' then 2
      when 'manager'           then 4
      when 'team_leader'       then 5
      when 'consultant'        then 7
      when 'agent'             then 10
      when 'stock_take_staff'  then 15
      when 'stock_take'        then 15
      when 'customer'          then 13
      when 'referrer'          then 14
      else case btrim(coalesce(p_role, ''))
        when '传福大使'   then 12
        when '改命客户'   then 13
        when '准传福大使' then 14
        else 12   -- unknown -> own-records-only (safe, matches client level>=12 path)
      end
    end
  )))::smallint;
$$;

-- (2) PRE-CHECK (read-only): list every account whose stored role_level disagrees
--     with its role string. Run this first to SEE what (3) will change.
--     (Left as a comment so this file stays a clean apply; uncomment to inspect.)
-- select id, full_name, email, role, role_level AS stored_level,
--        public._role_to_level(role) AS correct_level
-- from public.users
-- where role_level is distinct from public._role_to_level(role)
-- order by role_level, full_name;

-- (3) One-time backfill — reconcile the diverged rows. Idempotent.
update public.users
set role_level = public._role_to_level(role)
where role_level is distinct from public._role_to_level(role);

-- (4) Keep it synced forever: role_level becomes a server-derived mirror of role.
create or replace function public.users_sync_role_level()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.role_level := public._role_to_level(new.role);
  return new;
end;
$$;

drop trigger if exists users_sync_role_level on public.users;
create trigger users_sync_role_level
  before insert or update on public.users
  for each row execute function public.users_sync_role_level();

commit;

-- VERIFY (run after apply):
--   -- a) no rows should remain diverged:
--   select count(*) as still_diverged from public.users
--   where role_level is distinct from public._role_to_level(role);
--   -- b) confirm the reported account resolves to a non-admin scope:
--   select id, full_name, role, role_level from public.users
--   where full_name ilike '%oo kean cherng%';
--   -- c) confirm the team-leader scope (own + downline) the BFF will now return:
--   select public.bff_visible_agent_ids(
--     (select auth_user_id from public.users where full_name ilike '%oo kean cherng%' limit 1)
--   );
