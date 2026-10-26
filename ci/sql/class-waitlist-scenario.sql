-- Scenario test for migrations/2026-10-26_class_waitlist.sql. One DO block
-- that ALWAYS raises at the end (everything rolled back, no notification sent).
-- Result: CLASS_WAIT_RESULT {"pass","fail","failures"}
do $$
declare
    v_pid  bigint := 990000000000401;
    v_pid2 bigint := 990000000000402;
    v_cps  bigint := 990000000000411;
    v_topic bigint := 990000000000421;
    v_other bigint := 990000000000422;
    v_sess bigint := 990000000000431;
    v_sess2 bigint := 990000000000432;
    v_agent bigint := (select id from public.users order by id limit 1);
    v_today date := public.journey_today();
    v_n int; v_s text; v_e bigint; v_t text;
    v_pass int := 0; v_fail int := 0; v_msgs text[] := '{}';
begin
    insert into public.prospects (id, full_name, phone, status, responsible_agent_id) values
        (v_pid, 'TEST wait A (Claude)', '+60990000000401', 'active', v_agent),
        (v_pid2, 'TEST wait B (Claude)', '+60990000000402', 'active', v_agent);
    insert into public.events (id, title, categories) values
        (v_topic, 'TEST 九星与行业', '["个人风水基础课"]'),
        (v_other, 'TEST 汇集 Condo', '["汇集灵活-Condo"]');

    -- 1. a meeting's step "wait for 个人风水基础课" → waiting entry, NO task
    insert into public.activities (id, prospect_id, activity_type, activity_title, activity_date, lead_agent_id, next_actions)
    values (v_cps, v_pid, 'CPS', 'TEST CPS', v_today - 1, v_agent, jsonb_build_array(
        jsonb_build_object('text', 'Waiting for 个人风水基础课', 'type', 'event', 'event_category', '个人风水基础课', 'due', (v_today + 7)::text),
        jsonb_build_object('text', 'Waiting for 汇集-灵活', 'type', 'event', 'event_category', '汇集-灵活', 'due', (v_today + 7)::text),
        jsonb_build_object('text', 'Call him', 'type', 'call', 'due', (v_today + 2)::text)));
    select count(*) into v_n from public.class_waitlist where prospect_id = v_pid and status = 'waiting';
    if v_n = 2 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('waiting entries ' || v_n); end if;
    select count(*) into v_n from public.journey_touchpoints where source_activity_id = v_cps;
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('class steps made tasks: ' || v_n); end if;

    -- 2. the same person can't wait twice for one class
    update public.activities set note_key_points = 'x', next_actions = next_actions where id = v_cps;
    select count(*) into v_n from public.class_waitlist where prospect_id = v_pid and category = '个人风水基础课';
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('duplicate wait ' || v_n); end if;

    -- 3. a session of the class is added → one invite task + one notification for the agent
    insert into public.activities (id, activity_type, activity_title, activity_date, event_id)
    values (v_sess, 'EVENT', 'TEST 九星与行业', v_today + 10, v_topic);
    select title, (select due_date from public.journey_touchpoints where source_interest_id = w.id) into v_t, v_s
      from public.class_waitlist w join public.journey_touchpoints t on t.source_interest_id = w.id
     where w.prospect_id = v_pid and w.category = '个人风水基础课' limit 1;
    if v_t like '🎟️ Invite to TEST 九星与行业%' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('invite task: ' || coalesce(v_t, 'none')); end if;
    if v_s::date = v_today + 7 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('invite due ' || coalesce(v_s, 'null')); end if;
    select count(*) into v_n from public.notification_outbox where dedupe_key = 'class_wait:' || v_sess and user_id = v_agent;
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('notifications ' || v_n); end if;

    -- 4. a more specific category matches the broader class (汇集-灵活 → 汇集灵活-Condo)
    insert into public.activities (id, activity_type, activity_title, activity_date, event_id)
    values (v_sess2, 'EVENT', 'TEST 汇集 Condo', v_today + 12, v_other);
    select count(*) into v_n from public.journey_touchpoints t join public.class_waitlist w on w.id = t.source_interest_id
     where w.prospect_id = v_pid and w.category = '汇集-灵活';
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('broader class match ' || v_n); end if;
    -- and the 九星 waiter is not invited to the 汇集 session
    select count(*) into v_n from public.class_wait_entries_for(v_sess2) w where w.category = '个人风水基础课';
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'wrong class matched'::text; end if;

    -- 5. the event screen lists the waiting person
    select count(*) into v_n from public.class_wait_entries_for(v_sess) where prospect_id = v_pid;
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('listed for session ' || v_n); end if;

    -- 6. registering them → invited, task done, off the list
    insert into public.event_attendees (id, event_id, activity_id, attendee_id, entity_id, entity_name, attendee_type, attendance_status)
    values (990000000000441, v_topic, v_sess, v_pid, v_pid, 'TEST', 'prospect', 'Registered');
    select status into v_s from public.class_waitlist where prospect_id = v_pid and category = '个人风水基础课';
    if v_s = 'invited' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('after register ' || v_s); end if;
    select t.status into v_s from public.journey_touchpoints t join public.class_waitlist w on w.id = t.source_interest_id
     where w.prospect_id = v_pid and w.category = '个人风水基础课';
    if v_s = 'done' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('invite task ' || v_s); end if;
    select count(*) into v_n from public.class_wait_entries_for(v_sess) where prospect_id = v_pid;
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'still listed after register'::text; end if;

    -- 7. attended → attended
    update public.event_attendees set attended = true, attendance_status = 'Attended' where id = 990000000000441;
    select status into v_s from public.class_waitlist where prospect_id = v_pid and category = '个人风水基础课';
    if v_s = 'attended' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('after attend ' || v_s); end if;

    -- 8. a class picked when a session already exists → invite task at once
    insert into public.activities (id, prospect_id, activity_type, activity_title, activity_date, lead_agent_id, next_actions)
    values (990000000000412, v_pid2, 'FTF', 'TEST FTF', v_today, v_agent, jsonb_build_array(
        jsonb_build_object('text', 'Waiting', 'type', 'event', 'event_category', '个人风水基础课')));
    select count(*) into v_n from public.journey_touchpoints t join public.class_waitlist w on w.id = t.source_interest_id where w.prospect_id = v_pid2;
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('immediate match ' || v_n); end if;

    -- 9. removing the class step → dropped, its task skipped
    update public.activities set next_actions = '[]'::jsonb where id = 990000000000412;
    select status into v_s from public.class_waitlist where prospect_id = v_pid2;
    select t.status into v_t from public.journey_touchpoints t join public.class_waitlist w on w.id = t.source_interest_id where w.prospect_id = v_pid2;
    if v_s = 'dropped' and v_t = 'skipped' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('drop ' || coalesce(v_s, '-') || '/' || coalesce(v_t, '-')); end if;

    -- 10. 6-month expiry
    update public.class_waitlist set created_at = now() - interval '7 months' where prospect_id = v_pid and category = '汇集-灵活';
    perform public.class_wait_expire();
    select status into v_s from public.class_waitlist where prospect_id = v_pid and category = '汇集-灵活';
    if v_s = 'expired' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('expiry ' || v_s); end if;

    -- 11. matching helpers
    if public.class_cat_match('汇聚-专案', array['汇集专案-Condo']) and not public.class_cat_match('个人风水基础课', array['环境风水基础课'])
       and not public.class_cat_match('x', array['']) then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'cat match helper'::text; end if;

    raise exception 'CLASS_WAIT_RESULT %', json_build_object('pass', v_pass, 'fail', v_fail, 'failures', v_msgs);
end $$;
