-- Phase 2 (#11 BFF / #6 RBAC) — server-side visibility scope. Additive.
-- The BFF (api/customers.mjs) calls this with the authenticated user's auth uid
-- to compute the visible agent-id set SERVER-SIDE, mirroring the client
-- getVisibleUserIds (script.js) exactly — using the authoritative role_level
-- column instead of parsing the role string:
--   role_level <= 2  -> NULL  (unrestricted: super admin / marketing manager)
--   role_level >= 12 -> [self] (ambassador / customer / referrer: own records)
--   role_level 3..11 -> self + downline via reporting_to, restricted to the same
--                       team_id (or null team_id), with cycle-safe recursion.
-- Returns NULL = "all" (no scope filter); empty array = "see nothing".

create or replace function public.bff_visible_agent_ids(p_auth_id uuid)
returns bigint[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    bigint;
  v_level smallint;
  v_team  bigint;
  v_ids   bigint[];
begin
  select id, role_level, team_id
    into v_id, v_level, v_team
  from users
  where auth_user_id = p_auth_id
  limit 1;

  if v_id is null then
    return array[]::bigint[];          -- unknown caller -> see nothing
  end if;
  if v_level <= 2 then
    return null;                       -- unrestricted
  end if;
  if v_level >= 12 then
    return array[v_id];                -- own records only
  end if;

  with recursive dl as (
    select u.id, u.team_id
    from users u
    where u.id = v_id
    union
    select c.id, c.team_id
    from users c
    join dl on c.reporting_to = dl.id
    where (v_team is null or c.team_id is null or c.team_id = v_team)
  )
  select array_agg(distinct id) into v_ids from dl;

  return coalesce(v_ids, array[v_id]);
end;
$$;

grant execute on function public.bff_visible_agent_ids(uuid) to authenticated, service_role;
