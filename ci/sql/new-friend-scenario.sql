-- Scenario test for migrations/2026-11-01_new_friends.sql — who is a New Friend,
-- who leaves the list, who sees it, the one Book CPS task, and a CPS closing it.
-- One DO block that ALWAYS raises (all rolled back).
-- Result: NEW_FRIEND_RESULT {"pass","fail","failures"}
do $$
declare
    v_today date := public.journey_today();
    v_agent bigint; v_lead bigint; v_other bigint; v_ua uuid; v_ul uuid; v_uo uuid;
    v_topic bigint := 990000000003001;
    v_past bigint := 990000000003011; v_next bigint := 990000000003012; v_old bigint := 990000000003013;
    v_came bigint := 990000000003021;     -- came yesterday, no CPS → on the list, gets the task
    v_cps bigint := 990000000003022;      -- came, then a CPS logged → off the list
    v_booked bigint := 990000000003023;   -- came, CPS booked next week → on the list, booked, no task
    v_coming bigint := 990000000003024;   -- next event, not come yet → on the list, no task
    v_noshow bigint := 990000000003025;   -- no show → on the list, no task
    v_form bigint := 990000000003026;     -- came, CPS form on file → off the list
    v_bought bigint := 990000000003027;   -- came, sale approved → off the list
    v_gradef bigint := 990000000003028;   -- came, grade F → off the list
    v_oldname bigint := 990000000003029;  -- came, NOT tagged (old name) → never on the list
    v_late bigint := 990000000003030;     -- came 20 days ago → on the list, too late for a task
    v_unmarked bigint := 990000000003031; -- event passed, attendance not marked
    v_rows jsonb; v_r jsonb; v_n int; v_id bigint;
    v_pass int := 0; v_fail int := 0; v_msgs text[] := '{}';
begin
    select a.id, b.id, a.auth_user_id, b.auth_user_id into v_agent, v_lead, v_ua, v_ul
      from public.users a join public.users b on b.id = a.reporting_to
     where a.auth_user_id is not null and b.auth_user_id is not null and a.role_level between 6 and 11 and b.role_level between 3 and 10
     order by a.id limit 1;
    select u.id, u.auth_user_id into v_other, v_uo from public.users u
     where u.role_level between 6 and 11 and u.auth_user_id is not null and u.id not in (v_agent, v_lead)
       and v_agent not in (select public.pipeline_tree_ids(u.id, true)) order by u.id limit 1;
    if v_agent is null or v_other is null then raise exception 'NEW_FRIEND_RESULT setup: no agent with a leader'; end if;

    insert into public.events (id, title, categories) values (v_topic, 'TEST 汇集 (Claude)', '["汇集"]');
    insert into public.activities (id, activity_type, activity_title, activity_date, event_id, lead_agent_id, visibility) values
        (v_past, 'EVENT', 'TEST 汇集', v_today - 1, v_topic, v_agent, 'open'),
        (v_next, 'EVENT', 'TEST 汇集 next', v_today + 3, v_topic, v_agent, 'open'),
        (v_old, 'EVENT', 'TEST 汇集 old', v_today - 20, v_topic, v_agent, 'open');
    insert into public.prospects (id, full_name, phone, status, responsible_agent_id, referred_by, source, source_id) values
        (v_came, 'TEST nf came (Claude)', '+60990000003021', 'active', v_agent, 'TEST Referrer', 'event_new_friend', v_past),
        (v_cps, 'TEST nf cps (Claude)', '+60990000003022', 'active', v_agent, null, 'event_new_friend', v_past),
        (v_booked, 'TEST nf booked (Claude)', '+60990000003023', 'active', v_agent, null, 'event_new_friend', v_past),
        (v_coming, 'TEST nf coming (Claude)', '+60990000003024', 'active', v_agent, null, 'event_new_friend', v_next),
        (v_noshow, 'TEST nf noshow (Claude)', '+60990000003025', 'active', v_agent, null, 'event_new_friend', v_past),
        (v_form, 'TEST nf form (Claude)', '+60990000003026', 'active', v_agent, null, 'event_new_friend', v_past),
        (v_bought, 'TEST nf bought (Claude)', '+60990000003027', 'active', v_agent, null, 'event_new_friend', v_past),
        (v_gradef, 'TEST nf F (Claude)', '+60990000003028', 'active', v_agent, null, 'event_new_friend', v_past),
        (v_oldname, 'TEST old name (Claude)', '+60990000003029', 'active', v_agent, null, null, null),
        (v_late, 'TEST nf late (Claude)', '+60990000003030', 'active', v_agent, null, 'event_new_friend', v_old),
        (v_unmarked, 'TEST nf unmarked (Claude)', '+60990000003031', 'active', v_agent, null, 'event_new_friend', v_past);
    update public.prospects set cps_form_date = v_today where id = v_form;
    update public.prospects set conversion_status = 'approved' where id = v_bought;
    update public.prospects set manual_grade = 'F' where id = v_gradef;
    insert into public.event_attendees (id, event_id, activity_id, attendee_id, entity_id, entity_name, attendee_type, attendance_status, attended, created_at) values
        (990000000003041, v_topic, v_past, v_came, v_came, 'T', 'prospect', 'Attended', true, now()),
        (990000000003042, v_topic, v_past, v_cps, v_cps, 'T', 'prospect', 'Attended', true, now()),
        (990000000003043, v_topic, v_past, v_booked, v_booked, 'T', 'prospect', 'Late', false, now()),
        (990000000003044, v_topic, v_next, v_coming, v_coming, 'T', 'prospect', 'Registered', false, now()),
        (990000000003045, v_topic, v_past, v_noshow, v_noshow, 'T', 'prospect', 'No Show', false, now()),
        (990000000003046, v_topic, v_past, v_form, v_form, 'T', 'prospect', 'Attended', true, now()),
        (990000000003047, v_topic, v_past, v_bought, v_bought, 'T', 'prospect', 'Attended', true, now()),
        (990000000003048, v_topic, v_past, v_gradef, v_gradef, 'T', 'prospect', 'Attended', true, now()),
        (990000000003049, v_topic, v_past, v_oldname, v_oldname, 'T', 'prospect', 'Attended', true, now()),
        (990000000003050, v_topic, v_old, v_late, v_late, 'T', 'prospect', 'Attended', true, now()),
        (990000000003051, v_topic, v_past, v_unmarked, v_unmarked, 'T', 'prospect', 'Registered', false, now());
    insert into public.activities (id, activity_type, activity_title, activity_date, prospect_id, lead_agent_id, visibility) values
        (990000000003061, 'CPS', 'TEST CPS done', v_today, v_cps, v_agent, 'closed'),
        (990000000003062, 'CPS', 'TEST CPS booked', v_today + 6, v_booked, v_agent, 'closed');

    -- ── the daily job ──
    v_r := public.new_friend_daily();
    select count(*) into v_n from public.journey_touchpoints where source_kind = 'new_friend' and prospect_id = v_came and status = 'pending' and due_date = v_today;
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('came task ' || v_n); end if;
    select count(*) into v_n from public.journey_touchpoints where source_kind = 'new_friend'
       and prospect_id in (v_cps, v_booked, v_coming, v_noshow, v_form, v_bought, v_gradef, v_oldname, v_late, v_unmarked);
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('tasks for others ' || v_n); end if;
    -- run twice: still one task
    perform public.new_friend_daily();
    select count(*) into v_n from public.journey_touchpoints where source_kind = 'new_friend' and prospect_id = v_came;
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('second run ' || v_n); end if;
    -- the task reaches Do today
    select count(*) into v_n from public.journey_todo_for(v_agent) t where t.prospect_id = v_came;
    if v_n >= 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('not in do today ' || v_n); end if;

    -- ── as the agent ──
    perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_ua::text, true);
    execute 'set local role authenticated';
    select jsonb_agg(to_jsonb(x)) into v_rows from public.new_friend_list() x where x.prospect_id between 990000000003021 and 990000000003031;
    select count(*) into v_n from jsonb_array_elements(v_rows) e;
    if v_n = 6 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('list size ' || v_n || ' ' || v_rows::text); end if;
    if not exists (select 1 from jsonb_array_elements(v_rows) e where (e ->> 'prospect_id')::bigint in (v_cps, v_form, v_bought, v_gradef, v_oldname)) then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'someone stayed who must leave'::text; end if;
    if exists (select 1 from jsonb_array_elements(v_rows) e where (e ->> 'prospect_id')::bigint = v_came and e ->> 'state' = 'came' and (e ->> 'days_waiting')::int = 1
                 and e ->> 'event_title' = 'TEST 汇集 (Claude)' and e ->> 'brought_by' = 'TEST Referrer' and e ->> 'agent_name' is not null) then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'came row'::text; end if;
    if exists (select 1 from jsonb_array_elements(v_rows) e where (e ->> 'prospect_id')::bigint = v_booked and e ->> 'state' = 'came' and (e ->> 'cps_booked')::date = v_today + 6) then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'booked row (Late counts as came)'::text; end if;
    if exists (select 1 from jsonb_array_elements(v_rows) e where (e ->> 'prospect_id')::bigint = v_coming and e ->> 'state' = 'coming') then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'coming row'::text; end if;
    if exists (select 1 from jsonb_array_elements(v_rows) e where (e ->> 'prospect_id')::bigint = v_noshow and e ->> 'state' = 'no_show') then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'no show row'::text; end if;
    if exists (select 1 from jsonb_array_elements(v_rows) e where (e ->> 'prospect_id')::bigint = v_unmarked and e ->> 'state' = 'unmarked') then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'unmarked row'::text; end if;
    -- booked rows sort last
    if ((v_rows -> (jsonb_array_length(v_rows) - 1)) ->> 'prospect_id')::bigint = v_booked then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'booked sorts last'::text; end if;
    execute 'reset role';

    -- ── the leader sees the agent's people, another team does not ──
    perform set_config('request.jwt.claims', json_build_object('sub', v_ul, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_ul::text, true);
    execute 'set local role authenticated';
    select count(*) into v_n from public.new_friend_list() x where x.prospect_id between 990000000003021 and 990000000003031;
    if v_n = 6 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('leader sees ' || v_n); end if;
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', v_uo, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_uo::text, true);
    execute 'set local role authenticated';
    select count(*) into v_n from public.new_friend_list() x where x.prospect_id between 990000000003021 and 990000000003031;
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('other team sees ' || v_n); end if;
    -- the rule and the job stay private
    begin
        perform public.nf_rows(v_today);
        v_fail := v_fail + 1; v_msgs := v_msgs || 'nf_rows open to agents'::text;
    exception when insufficient_privilege then v_pass := v_pass + 1; end;
    begin
        perform public.new_friend_daily();
        v_fail := v_fail + 1; v_msgs := v_msgs || 'daily open to agents'::text;
    exception when insufficient_privilege then v_pass := v_pass + 1; end;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    -- nobody logged in
    begin
        perform * from public.new_friend_list();
        v_fail := v_fail + 1; v_msgs := v_msgs || 'list open without a login'::text;
    exception when insufficient_privilege then v_pass := v_pass + 1; end;

    -- ── a CPS logged closes the task at once and they leave the list ──
    insert into public.activities (id, activity_type, activity_title, activity_date, prospect_id, lead_agent_id, visibility)
    values (990000000003063, 'CPS', 'TEST CPS later', v_today, v_came, v_agent, 'closed');
    select count(*) into v_n from public.journey_touchpoints where source_kind = 'new_friend' and prospect_id = v_came and status = 'done' and done_by_activity_id = 990000000003063;
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('cps closes task ' || v_n); end if;
    select count(*) into v_n from public.nf_rows(v_today) r where r.prospect_id = v_came;
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'still listed after CPS'::text; end if;
    -- once ever: the job does not make a second task
    delete from public.activities where id = 990000000003063;
    perform public.new_friend_daily();
    select count(*) into v_n from public.journey_touchpoints where source_kind = 'new_friend' and prospect_id = v_came;
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('once ever ' || v_n); end if;

    -- ── graded F while the task is open: the job closes it ──
    insert into public.journey_touchpoints (prospect_id, stage_name, track, touchpoint_type, title, due_date, priority, status, assigned_to_id, follow_mode, auto_created, source_kind)
    values (v_noshow, 'new_friend_cps', 'active', 'task', 'TEST', v_today, 'high', 'pending', v_agent, 'active', true, 'new_friend') returning id into v_id;
    update public.prospects set manual_grade = 'F' where id = v_noshow;
    perform public.new_friend_daily();
    select count(*) into v_n from public.journey_touchpoints where id = v_id and status = 'skipped';
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('F closes task ' || v_n); end if;

    -- ── the invite reason wording ──
    select count(*) into v_n from pg_proc p where p.proname = 'inv_compute' and p.prosrc like '%Recent CPS%' and p.prosrc not like '%New friend%';
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'invite label'::text; end if;
    -- the cron is on
    select count(*) into v_n from cron.job where jobname = 'new-friend-daily' and active;
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'cron'::text; end if;

    raise exception 'NEW_FRIEND_RESULT %', jsonb_build_object('pass', v_pass, 'fail', v_fail, 'failures', to_jsonb(v_msgs))::text;
end $$;
