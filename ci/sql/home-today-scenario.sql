-- Scenario test for migrations/2026-10-26_home_today.sql (home_goal + late
-- birthday wishes). One DO block that ALWAYS raises at the end (all rolled back).
-- Result: HOME_TODAY_RESULT {"pass","fail","failures"}
do $$
declare
    v_leader bigint;
    v_agent  bigint;
    v_auth   uuid;
    v_today  date := public.journey_today();
    v_month  text := to_char(public.journey_today(), 'YYYY-MM');
    g0 jsonb; g1 jsonb; g2 jsonb;
    v_s text;
    v_pass int := 0; v_fail int := 0; v_msgs text[] := '{}';
begin
    -- a leader with at least one direct report, and that report
    select u.id into v_leader from public.users u
     where u.role_level between 3 and 5 and u.auth_user_id is not null
       and exists (select 1 from public.users d where d.reporting_to = u.id)
     order by u.id limit 1;
    select d.id, d.auth_user_id into v_agent, v_auth from public.users d where d.reporting_to = v_leader and d.auth_user_id is not null order by d.id limit 1;

    -- as the agent
    perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
    g0 := public.home_goal();
    insert into public.purchases (id, agent_id, amount, date, status, item) values
        (990000000000901, v_agent, 12345, v_today, 'completed', 'TEST home goal (Claude)'),
        (990000000000902, v_agent, 99999, v_today, 'cancelled', 'TEST home goal cancelled (Claude)'),
        (990000000000903, v_agent, 7000, (date_trunc('month', v_today) - interval '1 day')::date, 'completed', 'TEST last month (Claude)');
    g1 := public.home_goal();
    if (g1->'me'->>'won')::numeric - (g0->'me'->>'won')::numeric = 12345 and (g1->'me'->>'n')::int = (g0->'me'->>'n')::int + 1
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('own won ' || g0::text || ' → ' || g1::text); end if;
    if (select role_level from public.users where id = v_agent) between 3 and 12 and (g1->'me'->>'target')::numeric = 100000
       and not exists (select 1 from public.pipeline_goals where user_id = v_agent and month = v_month and scope = 'personal')
    then v_pass := v_pass + 1;
    elsif exists (select 1 from public.pipeline_goals where user_id = v_agent and month = v_month and scope = 'personal') then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('default target ' || g1::text); end if;
    delete from public.pipeline_goals where user_id = v_agent and month = v_month and scope = 'personal';
    insert into public.pipeline_goals (user_id, month, scope, target_amount) values (v_agent, v_month, 'personal', 55000);
    if (public.home_goal()->'me'->>'target')::numeric = 55000 then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'custom personal goal'::text; end if;

    -- as the leader: the report's sale counts toward the team
    perform set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from public.users where id = v_leader), 'role', 'authenticated')::text, true);
    g2 := public.home_goal();
    if g2 ? 'team' and (g2->'team'->>'target')::numeric > 0 and (g2->'team'->>'won')::numeric >= 12345
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('team ' || g2::text); end if;

    -- not signed in → nothing personal
    perform set_config('request.jwt.claims', '{}', true);
    if not (public.home_goal() ? 'me') then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'anon got a goal'::text; end if;

    -- late birthday wishes drop after a day; other follow-ups keep their 14 days
    insert into public.follow_up_drafts (id, trigger_type, due_date, message_text, status, agent_id) values
        (990000000000911, 'birthday', v_today - 2, 'TEST', 'pending', v_agent),
        (990000000000912, 'birthday', v_today - 1, 'TEST', 'pending', v_agent),
        (990000000000913, 're_engagement', v_today - 5, 'TEST', 'pending', v_agent);
    perform public.expire_old_follow_up_drafts();
    select string_agg(id::text || '=' || status, ',' order by id) into v_s from public.follow_up_drafts where id between 990000000000911 and 990000000000913;
    if v_s = '990000000000911=expired,990000000000912=pending,990000000000913=pending'
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('expiry ' || coalesce(v_s, '-')); end if;

    raise exception 'HOME_TODAY_RESULT %', json_build_object('pass', v_pass, 'fail', v_fail, 'failures', v_msgs);
end $$;
