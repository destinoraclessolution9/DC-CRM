-- Scenario test for migrations/2026-11-03_team_birthdays_rpc.sql
-- (my_team_birthdays). One DO block that ALWAYS raises at the end (all rolled
-- back). Same org chart as ci/test-team-birthday-privacy.js, ids offset by
-- 990000000000000, so the server rule is checked against the browser + push rule.
-- Result: TEAM_BDAY_RESULT {"pass","fail","failures"}
do $$
declare
    b constant bigint := 990000000000000;
    v_got text; v_want text;
    v_pass int := 0; v_fail int := 0; v_msgs text[] := '{}';
    r record;
begin
    -- ── Org chart (see the JS test) ─────────────────────────────────────────
    --   1 Boss (L1)        2 Marketing (L2)
    --   3 Senior Mgr (L3) → 1
    --   5 Leader A (L5) → 3          6 Leader B (L5, other branch) → 3
    --   9 Senior Peer (L12) → 5
    --   8 Old Agent (L12, INACTIVE) → 9
    --   7 Upline U (L12, same level as X) → 8
    --  10 Agent X (L12) → 7          11 Peer (L12) → 5      12 Downline (L12) → 10
    --  20 "Leader A" duplicate account (L12, no upline)    15 Stock Take (L15)
    --  30 ↔ 31 reporting loop (both L12)
    --  40 Customer (L13)   41 No Birthday (L12)   42 Bad IC (L12)   43 Deleted (L12)
    insert into public.users (id, full_name, role, status, reporting_to, date_of_birth, ic_number, auth_user_id)
    select b + x.id, x.nm, x.role, x.st, case when x.up is null then null else b + x.up end,
           x.dob::date, x.ic, gen_random_uuid()
      from (values
        (1, 'ZZTEST Boss', 'Level 1 Staff', 'active', null, '1970-01-05', null),
        (2, 'ZZTEST Marketing', 'Level 2 Staff', 'active', null, '1971-02-06', null),
        (3, 'ZZTEST Senior Mgr', 'Level 3 Staff', 'active', 1, null, '720307-14-5555'),
        (5, 'ZZTEST Leader A', 'Level 5 Staff', 'active', 3, null, '750408-10-1234'),
        (6, 'ZZTEST Leader B', 'Level 5 Staff', 'active', 3, '1976-05-09', null),
        (9, 'ZZTEST Senior Peer', 'Level 12 Staff', 'active', 5, null, '800610-14-0000'),
        (8, 'ZZTEST Old Agent', 'Level 12 Staff', 'inactive', 9, '1981-07-11', null),
        (7, 'ZZTEST Upline U', 'Level 12 Staff', 'active', 8, null, '820812-08-1111'),
        (10, 'ZZTEST Agent X', 'Level 12 Staff', 'active', 7, null, '900913-10-2222'),
        (11, 'ZZTEST Peer', 'Level 12 Staff', 'active', 5, '1991-10-14', null),
        (12, 'ZZTEST Downline', 'Level 12 Staff', 'active', 10, null, '921115 14 3333'),
        (20, ' zztest leader a ', 'Level 12 Staff', 'active', null, '1975-04-08', null),
        (15, 'ZZTEST Stock Take', 'Level 15 Stock Take', 'active', null, '1993-12-16', null),
        (30, 'ZZTEST Loop One', 'Level 12 Staff', 'active', 31, '1994-01-17', null),
        (31, 'ZZTEST Loop Two', 'Level 12 Staff', 'active', 30, '1995-02-18', null),
        (40, 'ZZTEST Customer', 'Level 13 Customer', 'active', null, '1996-03-19', null),
        (41, 'ZZTEST No Birthday', 'Level 12 Staff', 'active', 5, null, 'A1234567'),
        (42, 'ZZTEST Bad IC', 'Level 12 Staff', 'active', 5, null, '901345-10-1111'),
        (43, 'ZZTEST Deleted', 'Level 12 Staff', 'deleted', 5, '1997-04-20', null)
      ) as x(id, nm, role, st, up, dob, ic);

    -- Visible test ids for each viewer (the JS test's cases + the extra rows).
    for r in select * from (values
        (10, '10,11,12,15,30,31', 'L12 agent: chain + seniors + duplicate hidden'),
        (5, '5,6,7,9,10,11,12,15,20,30,31', 'L5 leader: only L1-L3 hidden'),
        (30, '7,9,10,11,12,15,30', 'reporting loop terminates'),
        (1, '1,2,3,5,6,7,9,10,11,12,15,20,30,31', 'L1 admin sees every active staff birthday'),
        (2, '1,2,3,5,6,7,9,10,11,12,15,20,30,31', 'L2 marketing sees every active staff birthday'),
        (40, '', 'L13 customer account sees nothing')
    ) as c(viewer, want, why) loop
        perform set_config('request.jwt.claims', json_build_object('sub',
            (select auth_user_id from public.users where id = b + r.viewer), 'role', 'authenticated')::text, true);
        select coalesce(string_agg((t.id - b)::text, ',' order by t.id), '') into v_got
          from public.my_team_birthdays() t where t.id between b and b + 999;
        if v_got = r.want then v_pass := v_pass + 1;
        else v_fail := v_fail + 1; v_msgs := v_msgs || format('%s: got [%s] want [%s]', r.why, v_got, r.want); end if;
    end loop;

    -- MM-DD from date_of_birth, from the IC (dashes or spaces), never the year.
    perform set_config('request.jwt.claims', json_build_object('sub',
        (select auth_user_id from public.users where id = b + 1), 'role', 'authenticated')::text, true);
    select string_agg((t.id - b)::text || '=' || t.birthday_md, ',' order by t.id) into v_got
      from public.my_team_birthdays() t where t.id in (b + 3, b + 6, b + 12);
    v_want := '3=03-07,6=05-09,12=11-15';
    if v_got = v_want then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || format('birthday_md: got [%s] want [%s]', v_got, v_want); end if;

    -- Only the six safe columns come back (no IC, no full DOB).
    select string_agg(a.attname, ',' order by a.attnum) into v_got
      from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(attname, mode, attnum)
     where p.oid = 'public.my_team_birthdays()'::regprocedure and a.mode = 't';
    v_want := 'id,full_name,birthday_md,role,team,phone';
    if v_got = v_want then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || format('columns: got [%s] want [%s]', v_got, v_want); end if;

    -- Signed out (no profile) → nothing; anon may not call it at all.
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    if (select count(*) from public.my_team_birthdays()) = 0 then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'no profile: rows returned'::text; end if;
    if not has_function_privilege('anon', 'public.my_team_birthdays()', 'execute')
       and has_function_privilege('authenticated', 'public.my_team_birthdays()', 'execute') then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'grants: anon can call or authenticated cannot'::text; end if;

    -- calendar_dashboard_payload's users list no longer carries date_of_birth.
    if pg_get_functiondef('public.calendar_dashboard_payload(text, timestamptz, timestamptz)'::regprocedure)
       !~ 'reporting_to, date_of_birth' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'calendar_dashboard_payload still returns users.date_of_birth'::text; end if;

    raise exception 'TEAM_BDAY_RESULT %', json_build_object('pass', v_pass, 'fail', v_fail, 'failures', v_msgs);
end $$;
