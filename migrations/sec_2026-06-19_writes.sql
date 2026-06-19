-- =====================================================================
-- SECURITY HARDENING — Phase 1, group B/C/D: write scoping + users guard
-- Date: 2026-06-19
--
-- C3a: scope UPDATE on prospects/customers/activities to owned/visible rows
--      (was auth_write_update USING(true) WITH CHECK(true) -> any authenticated
--      user could reassign/steal any lead). DELETE already gated by the
--      RESTRICTIVE *_delete_lead_only (level<=5); INSERT left permissive
--      (data-pollution only, lower severity, many legit creation paths).
-- C3b: users-table column-guard trigger — non-admins cannot change privileged
--      columns (role/role_level/reporting_to/commission_rate/status/team/
--      auth_user_id) on ANY row, and cannot create a privileged role. Row-level
--      writes stay permissive so first-login auto-create, the login email
--      backfill, and self-profile edits keep working. Service-role (auth.uid()
--      IS NULL) and admins (level<=2) bypass.
-- Bujishu: was anon+authenticated ALL USING(true) -> anyone with the public key
--      could read/write/delete it. Lock to authenticated (mirrors products).
-- =====================================================================

-- ---------- C3a: prospects UPDATE scoping ----------
drop policy if exists auth_write_update on public.prospects;
create policy auth_write_update on public.prospects for update to authenticated
using (
  responsible_agent_id in (select current_user_visible_ids())
  or cps_agent_id      in (select current_user_visible_ids())
  or lead_agent_id     in (select current_user_visible_ids())
  or responsible_agent_id = current_user_row_id()
  or cps_agent_id         = current_user_row_id()
  or lead_agent_id        = current_user_row_id()
  or coalesce(current_user_level(),99) <= 2
)
with check (
  responsible_agent_id in (select current_user_visible_ids())
  or cps_agent_id      in (select current_user_visible_ids())
  or lead_agent_id     in (select current_user_visible_ids())
  or responsible_agent_id = current_user_row_id()
  or cps_agent_id         = current_user_row_id()
  or lead_agent_id        = current_user_row_id()
  or coalesce(current_user_level(),99) <= 2
);

-- ---------- C3a: customers UPDATE scoping ----------
drop policy if exists auth_write_update on public.customers;
create policy auth_write_update on public.customers for update to authenticated
using (
  responsible_agent_id in (select current_user_visible_ids())
  or responsible_agent_id = current_user_row_id()
  or coalesce(current_user_level(),99) <= 2
)
with check (
  responsible_agent_id in (select current_user_visible_ids())
  or responsible_agent_id = current_user_row_id()
  or coalesce(current_user_level(),99) <= 2
);

-- ---------- C3a: activities UPDATE scoping ----------
drop policy if exists auth_write_update on public.activities;
create policy auth_write_update on public.activities for update to authenticated
using (
  lead_agent_id in (select current_user_visible_ids())
  or lead_agent_id = current_user_row_id()
  or (co_agents @> jsonb_build_array(jsonb_build_object('id', current_user_row_id())))
  or (lead_agent_id is null and coalesce(current_user_level(),99) <= 2)
)
with check (
  lead_agent_id in (select current_user_visible_ids())
  or lead_agent_id = current_user_row_id()
  or (co_agents @> jsonb_build_array(jsonb_build_object('id', current_user_row_id())))
  or (lead_agent_id is null and coalesce(current_user_level(),99) <= 2)
);

-- ---------- Bujishu lockdown (drop anon, keep authenticated) ----------
drop policy if exists bujishu_all on public.bujishu;
create policy bujishu_auth_all on public.bujishu for all to authenticated
  using (true) with check (true);

-- ---------- C3b: users column-guard trigger ----------
create or replace function public.users_guard_privileged_cols()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $guard$
declare
  caller_level int := coalesce(public.current_user_level(), 99);
begin
  -- Service-role / edge-functions / direct DB (no end-user JWT) and admins bypass.
  if auth.uid() is null or caller_level <= 2 then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A non-admin may not create a privileged-role (Level 1-4) user.
    if coalesce(nullif(substring(coalesce(new.role,'') from 'Level\s+(\d+)'),'')::int, 99) <= 4 then
      raise exception 'users_guard: not authorized to create a privileged role';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.role            is distinct from old.role
       or new.role_level      is distinct from old.role_level
       or new.reporting_to    is distinct from old.reporting_to
       or new.commission_rate is distinct from old.commission_rate
       or new.status          is distinct from old.status
       or new.team            is distinct from old.team
       or new.team_id         is distinct from old.team_id
       or new.auth_user_id    is distinct from old.auth_user_id then
      raise exception 'users_guard: not authorized to change privileged user fields';
    end if;
    return new;
  end if;

  return new;
end;
$guard$;

drop trigger if exists users_guard on public.users;
create trigger users_guard before insert or update on public.users
  for each row execute function public.users_guard_privileged_cols();
