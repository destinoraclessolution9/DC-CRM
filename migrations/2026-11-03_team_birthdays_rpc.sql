-- 🎂 Team birthdays without staff IC / DOB (2026-11-03, owner). Phase 2 of the
-- team-birthday privacy work. Phase 1 hid the viewer's upline chain + everyone
-- more senior ON SCREEN, but every agent's browser still downloaded every
-- colleague's date_of_birth + ic_number to build those lists (public.users has
-- the policy auth_full_access, so any signed-in user can read every column).
--   * my_team_birthdays(): the colleagues whose birthday the caller may see, as
--     name + 'MM-DD' + role / team / phone only. Same rule as script.js
--     filterTeamBirthdays and the push digest's teamBirthdayHider:
--       hidden = the caller's reporting_to chain (same-level uplines included)
--              + anyone with a smaller level number, matched by id AND name
--              (so a hidden person's duplicate account can't slip through);
--       L1/L2 see everyone; the caller's own row always shows.
--     Rows are active staff only (L1-L12 + L15; not inactive/expired/deleted).
--     MM-DD comes from date_of_birth, else the IC's YYMMDD. L13 customer / L14
--     referrer callers get nothing.
--   * calendar_dashboard_payload: its users list stops carrying date_of_birth
--     (data.js never primes the users cache from it, so nothing reads it).
-- This does NOT restrict the users table itself: screens that still read other
-- staff's IC / DOB (the Agent edit form, getByIdFull) move first.
-- Test: ci/sql/team-birthdays-scenario.sql (rolled back).
-- Rollback: migrations/2026-11-03_team_birthdays_rpc_undo.sql

create or replace function public.my_team_birthdays()
returns table (id bigint, full_name text, birthday_md text, role text, team text, phone text)
language sql stable security definer set search_path = public, pg_temp as $$
    with recursive me as (
        select u.id, u.reporting_to, public.current_user_level() as lvl
          from public.users u
         where u.id = public.current_user_row_id()
    ),
    -- Up the reporting_to chain. UNION (not ALL) drops an id already found, so a
    -- reporting loop ends instead of spinning.
    chain (uid) as (
        select m.reporting_to from me m where m.reporting_to is not null
        union
        select u.reporting_to from chain c join public.users u on u.id = c.uid
         where u.reporting_to is not null
    ),
    lv as (
        select u.id, u.full_name, u.role, u.team, u.phone, u.status, u.date_of_birth,
               regexp_replace(coalesce(u.ic_number, ''), '\D', '', 'g') as ic,
               coalesce(u.role_level, public._role_to_level(u.role))::int as lvl,
               lower(btrim(coalesce(u.full_name, ''))) as nm
          from public.users u
    ),
    hidden as (
        select c.uid as id from chain c, me where c.uid <> me.id
        union
        select l.id from lv l, me where l.id <> me.id and l.lvl < me.lvl
    ),
    staff as (
        select l.id, l.full_name, l.role, l.team, l.phone, l.lvl, l.nm,
               coalesce(to_char(l.date_of_birth, 'MM-DD'),
                        case when l.ic ~ '^\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])'
                             then substr(l.ic, 3, 2) || '-' || substr(l.ic, 5, 2) end) as md
          from lv l
         where lower(coalesce(l.status, '')) not in ('inactive', 'expired', 'deleted')
           and (l.lvl <= 12 or l.lvl = 15)
    )
    select s.id, s.full_name, s.md, s.role, s.team, s.phone
      from staff s, me
     where (me.lvl <= 12 or me.lvl = 15)
       and s.md is not null
       and (me.lvl <= 2 or s.id = me.id or not (
                s.lvl < me.lvl
             or exists (select 1 from hidden h where h.id = s.id)
             or (s.nm <> '' and exists (select 1 from hidden h join lv x on x.id = h.id where x.nm = s.nm))))
     order by s.md, s.full_name;
$$;
revoke all on function public.my_team_birthdays() from public, anon;
grant execute on function public.my_team_birthdays() to authenticated;

-- calendar_dashboard_payload: drop date_of_birth from its users list in place
-- (the rest of the live definition is left exactly as it is).
do $$
declare v_def text; v_new text;
begin
    select pg_get_functiondef(p.oid) into strict v_def from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = 'calendar_dashboard_payload';
    v_new := replace(v_def, 'reporting_to, date_of_birth, created_at', 'reporting_to, created_at');
    if v_new <> v_def then execute v_new; end if;
end $$;
