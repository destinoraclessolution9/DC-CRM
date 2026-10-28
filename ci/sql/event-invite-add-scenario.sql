-- Scenario test for migrations/2026-10-28_event_invite_agent_add.sql — agents
-- add their own people: note, "Do not invite" blocked, recent decline / monthly
-- limit warn (then "Add anyway"), already registered → Coming, a leader's add
-- pushes the agent, another agent cannot add, the profile picker, and the
-- list / results split. One DO block that ALWAYS raises (all rolled back).
-- Result: EVENT_INVITE_ADD_RESULT {"pass","fail","failures"}
do $$
declare
    v_today date := public.journey_today();
    -- an agent and their leader (both can log in)
    v_agent bigint; v_lead bigint; v_other bigint; v_ua uuid; v_ul uuid; v_uo uuid;
    v_topic bigint := 990000000002001; v_topic2 bigint := 990000000002002;
    v_sess bigint := 990000000002011; v_sess2 bigint := 990000000002012;
    v_p1 bigint := 990000000002021; v_p2 bigint := 990000000002022; v_p3 bigint := 990000000002023;
    v_p4 bigint := 990000000002024; v_p5 bigint := 990000000002025;
    v_objs jsonb := '[{"line":"fengshui","goal":"decide"}]'::jsonb;
    v_r jsonb; v_s text; v_n int; v_id bigint;
    v_pass int := 0; v_fail int := 0; v_msgs text[] := '{}';
begin
    select a.id, b.id, a.auth_user_id, b.auth_user_id into v_agent, v_lead, v_ua, v_ul
      from public.users a join public.users b on b.id = a.reporting_to
     where a.auth_user_id is not null and b.auth_user_id is not null and a.role_level between 6 and 11 and b.role_level between 3 and 10
     order by a.id limit 1;
    select u.id, u.auth_user_id into v_other, v_uo from public.users u
     where u.role_level between 6 and 11 and u.auth_user_id is not null and u.id not in (v_agent, v_lead)
       and v_agent not in (select public.pipeline_tree_ids(u.id, true)) order by u.id limit 1;
    if v_agent is null then raise exception 'EVENT_INVITE_ADD_RESULT setup: no agent with a leader'; end if;

    insert into public.prospects (id, full_name, phone, status, responsible_agent_id, do_not_invite) values
        (v_p1, 'TEST add 1 (Claude)', '+60990000002021', 'active', v_agent, false),
        (v_p2, 'TEST add 2 DNI (Claude)', '+60990000002022', 'active', v_agent, true),
        (v_p3, 'TEST add 3 registered (Claude)', '+60990000002023', 'active', v_agent, false),
        (v_p4, 'TEST add 4 declined (Claude)', '+60990000002024', 'active', v_agent, false),
        (v_p5, 'TEST add 5 busy (Claude)', '+60990000002025', 'active', v_agent, false);
    insert into public.events (id, title, categories, invite_objectives) values
        (v_topic, 'TEST add event', '["老板每月主题课"]', v_objs), (v_topic2, 'TEST earlier event', '["老板每月主题课"]', v_objs);
    insert into public.activities (id, activity_type, activity_title, activity_date, event_id, lead_agent_id, visibility) values
        (v_sess, 'EVENT', 'TEST add event', v_today + 5, v_topic, v_agent, 'open'),
        (v_sess2, 'EVENT', 'TEST earlier event', v_today - 10, v_topic2, v_agent, 'open');
    insert into public.event_attendees (id, event_id, activity_id, attendee_id, entity_id, entity_name, attendee_type, attendance_status, created_at)
    values (990000000002031, v_topic, v_sess, v_p3, v_p3, 'TEST 3', 'prospect', 'Registered', now());
    -- p4 said "not interested" to an earlier event with the same purpose; p5 already got 2 invites this month
    insert into public.event_invites (activity_id, event_id, person_key, prospect_id, agent_id, objectives, grp, state, sent_at, reply, decline_reason, replied_at) values
        (v_sess2, v_topic2, 'p:' || v_p4, v_p4, v_agent, array['fengshui:decide'], 'strong', 'sent', now() - interval '9 days', 'declined', 'not_interested', now() - interval '9 days'),
        (v_sess2, v_topic2, 'p:' || v_p5, v_p5, v_agent, array['fengshui:decide'], 'strong', 'sent', now() - interval '9 days', 'coming', null, now() - interval '9 days');
    insert into public.activities (id, activity_type, activity_title, activity_date, event_id, lead_agent_id, visibility)
    values (990000000002013, 'EVENT', 'TEST other event', v_today - 5, v_topic2, v_agent, 'open');
    insert into public.event_invites (activity_id, event_id, person_key, prospect_id, agent_id, objectives, grp, state, sent_at)
    values (990000000002013, v_topic2, 'p:' || v_p5, v_p5, v_agent, array['general:introduce'], 'strong', 'sent', now() - interval '4 days');

    -- ── as the agent ──
    perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_ua::text, true);
    execute 'set local role authenticated';
    -- 1. own add with a note: saved, no push to themself
    v_r := public.event_invite_add(v_sess, v_p1, null, 'talked about moving house', false);
    v_id := (v_r ->> 'id')::bigint;
    if (v_r ->> 'ok')::boolean then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('own add ' || v_r::text); end if;
    -- 2. "Do not invite" is refused
    begin
        perform public.event_invite_add(v_sess, v_p2, null, null, true);
        v_fail := v_fail + 1; v_msgs := v_msgs || 'do-not-invite was added'::text;
    exception when others then
        if sqlerrm like '%Do not invite%' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('dni error ' || sqlerrm); end if;
    end;
    -- 3. already registered → Coming at once
    v_r := public.event_invite_add(v_sess, v_p3, null, null, false);
    if (v_r ->> 'registered')::boolean then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('registered ' || v_r::text); end if;
    -- 4. recent "not interested" for the same purpose → warning, then Add anyway
    v_r := public.event_invite_add(v_sess, v_p4, null, null, false);
    if v_r ->> 'warn' = 'paused' and v_r ->> 'message' like '%not interested%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('pause warn ' || v_r::text); end if;
    v_r := public.event_invite_add(v_sess, v_p4, null, 'asked again in person', true);
    if (v_r ->> 'ok')::boolean then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('add anyway ' || v_r::text); end if;
    -- 5. invited twice in 30 days → warning
    v_r := public.event_invite_add(v_sess, v_p5, null, null, false);
    if v_r ->> 'warn' = 'limit' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('limit warn ' || v_r::text); end if;
    -- 6. the profile picker sees the session, marks who is on the list / registered
    v_r := public.event_invite_person(v_p1, null);
    select count(*) into v_n from jsonb_array_elements(v_r -> 'sessions') x where (x ->> 'activity_id')::bigint = v_sess and (x ->> 'on_list')::boolean;
    if v_n = 1 and jsonb_array_length(v_r -> 'invites') >= 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('person picker ' || left(v_r::text, 200)); end if;
    -- 7. the list carries who added + the note; the agent row counts as "added"
    v_r := public.event_invite_list(v_sess);
    select x ->> 'add_note' into v_s from jsonb_array_elements(v_r -> 'rows') x where (x ->> 'id')::bigint = v_id;
    select (x ->> 'added')::int into v_n from jsonb_array_elements(v_r -> 'agents') x where (x ->> 'agent_id')::bigint = v_agent;
    if v_s = 'talked about moving house' and v_n >= 3 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('list note=' || coalesce(v_s, 'null') || ' added=' || coalesce(v_n::text, 'null')); end if;
    execute 'reset role';
    if not exists (select 1 from public.notification_outbox where dedupe_key = 'event_invite_add:' || v_id) then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'agent was pushed about their own add'::text; end if;

    -- 8. the leader adds to the agent's list → row is the agent's, the agent is pushed
    delete from public.event_invites where activity_id = v_sess and prospect_id = v_p1;
    perform set_config('request.jwt.claims', json_build_object('sub', v_ul, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_ul::text, true);
    execute 'set local role authenticated';
    v_r := public.event_invite_add(v_sess, v_p1, null, 'leader: bring her', false);
    v_id := (v_r ->> 'id')::bigint;
    execute 'reset role';
    if (select agent_id = v_agent and added_by = v_lead from public.event_invites where id = v_id)
       and exists (select 1 from public.notification_outbox where dedupe_key = 'event_invite_add:' || v_id and user_id = v_agent) then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'leader add / push'::text; end if;

    -- 9. another agent (not their leader) cannot add the agent's people
    if v_uo is not null then
        perform set_config('request.jwt.claims', json_build_object('sub', v_uo, 'role', 'authenticated')::text, true);
        perform set_config('request.jwt.claim.sub', v_uo::text, true);
        execute 'set local role authenticated';
        begin
            perform public.event_invite_add(v_sess, v_p5, null, null, true);
            v_fail := v_fail + 1; v_msgs := v_msgs || 'other agent could add'::text;
        exception when others then v_pass := v_pass + 1; end;
        execute 'reset role';
    end if;

    -- 10. results split CRM vs agent picks
    update public.event_invites set attended = true where id = v_id;
    perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_ua::text, true);
    execute 'set local role authenticated';
    v_r := public.event_invite_results(30);
    execute 'reset role';
    select (x ->> 'added')::int + 100 * (x ->> 'came_added')::int into v_n from jsonb_array_elements(v_r) x where (x ->> 'activity_id')::bigint = v_sess;
    if v_n >= 103 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('results split ' || coalesce(v_n::text, 'null')); end if;

    raise exception 'EVENT_INVITE_ADD_RESULT %', json_build_object('pass', v_pass, 'fail', v_fail, 'failures', v_msgs);
end $$;
