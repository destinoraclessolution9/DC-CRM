-- Scenario test for migrations/2026-11-01_cps_cancel.sql — who can cancel, what
-- can't be cancelled, what a cancel removes, the list, the task 3 days later,
-- and booking again. One DO block that ALWAYS raises (all rolled back).
-- Result: CPS_CANCEL_RESULT {"pass","fail","failures"}
do $$
declare
    v_today date := public.journey_today();
    v_agent bigint; v_lead bigint; v_other bigint; v_ua uuid; v_ul uuid; v_uo uuid;
    v_p bigint := 990000000005021;      -- booked CPS, cancelled by the agent
    v_min bigint := 990000000005022;    -- CPS with minutes
    v_form bigint := 990000000005023;   -- CPS form on file
    v_close bigint := 990000000005024;  -- CPS with a closing
    v_cust bigint := 990000000005025;   -- already a customer
    v_lead_p bigint := 990000000005026; -- cancelled by the leader
    v_pri bigint := 990000000005027;    -- real CPS before, a second one cancelled
    v_c1 bigint := 990000000005031; v_c2 bigint := 990000000005032; v_c3 bigint := 990000000005033;
    v_c4 bigint := 990000000005034; v_c5 bigint := 990000000005035; v_c6 bigint := 990000000005036;
    v_c7 bigint := 990000000005037; v_c8 bigint := 990000000005038;
    v_draft bigint := 990000000005041; v_old_draft bigint := 990000000005042;
    v_tp bigint;
    v_r jsonb; v_n int; v_s text;
    v_pass int := 0; v_fail int := 0; v_msgs text[] := '{}';
begin
    select a.id, b.id, a.auth_user_id, b.auth_user_id into v_agent, v_lead, v_ua, v_ul
      from public.users a join public.users b on b.id = a.reporting_to
     where a.auth_user_id is not null and b.auth_user_id is not null and a.role_level between 6 and 11 and b.role_level between 3 and 10
     order by a.id limit 1;
    select u.id, u.auth_user_id into v_other, v_uo from public.users u
     where u.role_level between 6 and 11 and u.auth_user_id is not null and u.id not in (v_agent, v_lead)
       and v_agent not in (select public.pipeline_tree_ids(u.id, true)) order by u.id limit 1;
    if v_agent is null or v_other is null then raise exception 'CPS_CANCEL_RESULT setup: no agent with a leader'; end if;

    insert into public.prospects (id, full_name, phone, status, responsible_agent_id, referred_by, source) values
        (v_p, 'TEST cancel (Claude)', '+60990000005021', 'active', v_agent, 'TEST Referrer', 'form_intake_old'),
        (v_min, 'TEST minutes (Claude)', '+60990000005022', 'active', v_agent, null, null),
        (v_form, 'TEST form (Claude)', '+60990000005023', 'active', v_agent, null, null),
        (v_close, 'TEST closing (Claude)', '+60990000005024', 'active', v_agent, null, null),
        (v_cust, 'TEST customer (Claude)', '+60990000005025', 'active', v_agent, null, null),
        (v_lead_p, 'TEST leader cancel (Claude)', '+60990000005026', 'active', v_agent, null, null),
        (v_pri, 'TEST second CPS (Claude)', '+60990000005027', 'active', v_agent, null, null);
    update public.prospects set cps_form_date = v_today where id = v_form;
    update public.prospects set status = 'converted' where id = v_cust;
    insert into public.activities (id, activity_type, activity_title, activity_date, start_time, venue, prospect_id, lead_agent_id, visibility) values
        (v_c1, 'CPS', 'TEST CPS', v_today, '15:00', 'TEST venue', v_p, v_agent, 'closed'),
        (v_c2, 'CPS', 'TEST CPS minutes', v_today - 1, '15:00', 'TEST venue', v_min, v_agent, 'closed'),
        (v_c3, 'CPS', 'TEST CPS form', v_today - 1, '15:00', 'TEST venue', v_form, v_agent, 'closed'),
        (v_c4, 'CPS', 'TEST CPS closing', v_today - 1, '15:00', 'TEST venue', v_close, v_agent, 'closed'),
        (v_c5, 'CPS', 'TEST CPS customer', v_today - 1, '15:00', 'TEST venue', v_cust, v_agent, 'closed'),
        (v_c6, 'CPS', 'TEST CPS leader', v_today + 4, '15:00', 'TEST venue', v_lead_p, v_agent, 'closed'),
        (v_c7, 'CPS', 'TEST CPS real', v_today - 40, '15:00', 'TEST venue', v_pri, v_agent, 'closed'),
        (v_c8, 'CPS', 'TEST CPS second', v_today + 2, '15:00', 'TEST venue', v_pri, v_agent, 'closed');
    update public.activities set note_key_points = 'talked' where id = v_c2;
    update public.activities set is_closing = true where id = v_c4;
    insert into public.follow_up_drafts (id, prospect_id, agent_id, trigger_type, message_text, event_id, due_date, status) values
        (v_draft, v_p, v_agent, 'appointment_reminder', 'TEST reminder', v_c1, v_today, 'pending'),
        (v_old_draft, v_p, v_agent, 're_engagement', 'TEST other draft', null, v_today, 'pending');
    insert into public.journey_touchpoints (prospect_id, stage_name, track, touchpoint_type, title, due_date, priority, status, assigned_to_id, follow_mode, auto_created, source_kind, source_activity_id)
    values (v_p, 'test', 'active', 'task', 'TEST from the CPS', v_today, 'normal', 'pending', v_agent, 'active', true, 'meeting', v_c1) returning id into v_tp;

    -- ── nobody logged in ──
    begin
        perform public.cps_cancel(v_c1, 'emergency', null);
        v_fail := v_fail + 1; v_msgs := v_msgs || 'cancel open without a login'::text;
    exception when insufficient_privilege then v_pass := v_pass + 1; end;

    -- ── another team ──
    perform set_config('request.jwt.claims', json_build_object('sub', v_uo, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_uo::text, true);
    execute 'set local role authenticated';
    begin
        perform public.cps_cancel(v_c1, 'emergency', null);
        v_fail := v_fail + 1; v_msgs := v_msgs || 'another team could cancel'::text;
    exception when insufficient_privilege then v_pass := v_pass + 1; end;
    -- the history table is closed to everyone
    begin
        perform 1 from public.cps_cancellations limit 1;
        v_fail := v_fail + 1; v_msgs := v_msgs || 'history readable'::text;
    exception when insufficient_privilege then v_pass := v_pass + 1; end;
    execute 'reset role';

    -- ── the agent ──
    perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_ua::text, true);
    execute 'set local role authenticated';
    foreach v_s in array array['bad', ''] loop
        begin
            perform public.cps_cancel(v_c1, v_s, null);
            v_fail := v_fail + 1; v_msgs := v_msgs || ('reason accepted: ' || v_s);
        exception when invalid_parameter_value then v_pass := v_pass + 1; end;
    end loop;
    -- a CPS that really happened stays
    declare v_id bigint; begin
        foreach v_id in array array[v_c2, v_c3, v_c4, v_c5] loop
            begin
                perform public.cps_cancel(v_id, 'other', null);
                v_fail := v_fail + 1; v_msgs := v_msgs || ('cancelled a real CPS ' || v_id);
            exception when invalid_parameter_value then v_pass := v_pass + 1; end;
        end loop;
    end;
    -- not a CPS
    begin
        perform public.cps_cancel(-1, 'other', null);
        v_fail := v_fail + 1; v_msgs := v_msgs || 'missing activity'::text;
    exception when invalid_parameter_value then v_pass := v_pass + 1; end;

    v_r := public.cps_cancel(v_c1, 'emergency', '  family matter  ');
    if (v_r ->> 'ok')::boolean then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('cancel ' || v_r::text); end if;
    execute 'reset role';

    select count(*) into v_n from public.activities where id = v_c1;
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'CPS row still there'::text; end if;
    select count(*) into v_n from public.cps_cancellations where prospect_id = v_p and reason = 'emergency' and note = 'family matter' and cps_date = v_today and venue = 'TEST venue' and cancelled_by = v_agent and activity_id = v_c1;
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'history row'::text; end if;
    select count(*) into v_n from public.prospects where id = v_p and cps_cancelled_on = v_today and source = 'form_intake_old';
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'marker / source changed'::text; end if;
    select count(*) into v_n from public.follow_up_drafts where id = v_draft and status = 'dismissed';
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'reminder draft not withdrawn'::text; end if;
    select count(*) into v_n from public.follow_up_drafts where id = v_old_draft and status = 'pending';
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'unrelated draft touched'::text; end if;
    select count(*) into v_n from public.journey_touchpoints where id = v_tp and status = 'skipped';
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'task from the CPS still open'::text; end if;
    -- the normal 🚫 notification: sent by an edge function after commit, so inside
    -- this rolled-back block all that can be seen is the queued request
    select count(*) into v_n from net.http_request_queue where url like '%notify-on-activity%' and convert_from(body, 'UTF8') like '%' || v_c1 || '%';
    if v_n >= 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('cancelled notification not queued ' || v_n); end if;
    select count(*) into v_n from public.activities where id in (v_c2, v_c3, v_c4, v_c5);
    if v_n = 4 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'a real CPS was removed'::text; end if;

    -- ── the list ──
    perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_ua::text, true);
    execute 'set local role authenticated';
    select to_jsonb(x) into v_r from public.new_friend_list() x where x.prospect_id = v_p;
    if v_r ->> 'state' = 'cps_cancelled' and v_r ->> 'cancel_reason' = 'Emergency' and v_r ->> 'cancel_note' = 'family matter'
       and (v_r ->> 'cancelled_cps_date')::date = v_today and (v_r ->> 'days_waiting')::int = 0 then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('list row ' || coalesce(v_r::text, 'missing')); end if;
    -- a real CPS earlier: a second one cancelled is not a New Friend
    perform public.cps_cancel(v_c8, 'clash', null);
    select count(*) into v_n from public.new_friend_list() x where x.prospect_id = v_pri;
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'had a real CPS, still listed'::text; end if;
    execute 'reset role';
    -- the other team doesn't see them
    perform set_config('request.jwt.claims', json_build_object('sub', v_uo, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_uo::text, true);
    execute 'set local role authenticated';
    select count(*) into v_n from public.new_friend_list() x where x.prospect_id = v_p;
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'other team sees them'::text; end if;
    execute 'reset role';

    -- ── the leader can cancel for the agent ──
    perform set_config('request.jwt.claims', json_build_object('sub', v_ul, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_ul::text, true);
    execute 'set local role authenticated';
    v_r := public.cps_cancel(v_c6, 'sick', null);
    if (v_r ->> 'ok')::boolean then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'leader cancel'::text; end if;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);

    -- ── the task: not before 3 days ──
    perform public.new_friend_daily();
    select count(*) into v_n from public.journey_touchpoints where prospect_id = v_p and source_kind = 'new_friend';
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'task too early'::text; end if;
    update public.cps_cancellations set created_at = now() - interval '2 days' where prospect_id = v_p;
    perform public.new_friend_daily();
    select count(*) into v_n from public.journey_touchpoints where prospect_id = v_p and source_kind = 'new_friend';
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'task on day 2'::text; end if;
    update public.cps_cancellations set created_at = now() - interval '3 days' where prospect_id = v_p;
    perform public.new_friend_daily();
    select count(*) into v_n from public.journey_touchpoints where prospect_id = v_p and source_kind = 'new_friend' and assigned_to_id = v_agent and status = 'pending'
       and due_date = v_today and title like '🌱 Book CPS again — cancelled%(Emergency)';
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('task day 3 ' || v_n); end if;
    perform public.new_friend_daily();
    select count(*) into v_n from public.journey_touchpoints where prospect_id = v_p and source_kind = 'new_friend';
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('one task only ' || v_n); end if;
    select count(*) into v_n from public.journey_todo_for(v_agent, 500) t where t.prospect_id = v_p;
    if v_n >= 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'not in do today'::text; end if;

    -- ── booking again: task closes, row shows booked ──
    insert into public.activities (id, activity_type, activity_title, activity_date, start_time, venue, prospect_id, lead_agent_id, visibility)
    values (990000000005039, 'CPS', 'TEST CPS again', v_today + 5, '15:00', 'TEST venue', v_p, v_agent, 'closed');
    select count(*) into v_n from public.journey_touchpoints where prospect_id = v_p and source_kind = 'new_friend' and status = 'done' and done_by_activity_id = 990000000005039;
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'booking closes the task'::text; end if;
    select count(*) into v_n from public.nf_rows(v_today) r where r.prospect_id = v_p and r.cps_booked = v_today + 5;
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'booked row'::text; end if;

    -- ── cancelled again: back with the new reason, a new task after 3 days ──
    perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_ua::text, true);
    execute 'set local role authenticated';
    perform public.cps_cancel(990000000005039, 'clash', null);
    select x.cancel_reason into v_s from public.new_friend_list() x where x.prospect_id = v_p;
    if v_s = 'Schedule clash' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('latest reason ' || coalesce(v_s, 'null')); end if;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    update public.cps_cancellations set created_at = now() - interval '3 days' where activity_id = 990000000005039;
    perform public.new_friend_daily();
    select count(*) into v_n from public.journey_touchpoints where prospect_id = v_p and source_kind = 'new_friend';
    if v_n = 2 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('second task ' || v_n); end if;

    -- ── a CPS done for real ends it ──
    insert into public.activities (id, activity_type, activity_title, activity_date, start_time, venue, prospect_id, lead_agent_id, visibility)
    values (990000000005040, 'CPS', 'TEST CPS done', v_today, '15:00', 'TEST venue', v_p, v_agent, 'closed');
    select count(*) into v_n from public.nf_rows(v_today) r where r.prospect_id = v_p;
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'listed after a real CPS'::text; end if;

    raise exception 'CPS_CANCEL_RESULT %', jsonb_build_object('pass', v_pass, 'fail', v_fail, 'failures', to_jsonb(v_msgs))::text;
end $$;
