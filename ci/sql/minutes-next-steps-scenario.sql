-- Scenario test for migrations/2026-10-26_minutes_next_steps.sql (several next
-- steps per meeting). One DO block that ALWAYS raises at the end, so every row
-- it writes is rolled back. Result: MINUTES_STEPS_RESULT {"pass","fail","failures"}
do $$
declare
    v_pid  bigint := 990000000000301;
    v_aid  bigint := 990000000000311;
    v_old  bigint := 990000000000312;
    v_today date := public.journey_today();
    v_n int; v_t text; v_d date; v_s text; v_done boolean;
    v_pass int := 0; v_fail int := 0; v_msgs text[] := '{}';
begin
    insert into public.prospects (id, full_name, phone, status) values (v_pid, 'TEST minutes steps (Claude)', '+60990000000301', 'active');

    -- 1. two steps → two tasks, typed, titled, dated
    insert into public.activities (id, prospect_id, activity_type, activity_title, activity_date, next_action, next_actions)
    values (v_aid, v_pid, 'CPS', 'TEST CPS', v_today - 1, 'Call about RM18,990; Meet with wife',
        jsonb_build_array(
            jsonb_build_object('text', 'Follow up on RM18,990 package', 'type', 'call', 'due', (v_today + 7)::text),
            jsonb_build_object('text', 'Meet client & wife', 'type', 'meetup', 'due', (v_today + 10)::text)));
    select count(*) into v_n from public.journey_touchpoints where source_activity_id = v_aid;
    if v_n = 2 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('two steps made ' || v_n); end if;
    select title, due_date, touchpoint_type into v_t, v_d, v_s from public.journey_touchpoints where source_activity_id = v_aid and source_seq = 1;
    if v_t = '📞 Follow up on RM18,990 package' and v_d = v_today + 7 and v_s = 'call' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('row1 ' || coalesce(v_t, 'null')); end if;
    select title, touchpoint_type into v_t, v_s from public.journey_touchpoints where source_activity_id = v_aid and source_seq = 2;
    if v_t = '🤝 Meet client & wife' and v_s = 'meeting' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('row2 ' || coalesce(v_t, 'null')); end if;
    select count(*) into v_n from public.journey_touchpoints where source_activity_id = v_aid and source_seq = 0;
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'legacy task made alongside the list'::text; end if;

    -- 2. a task rescheduled in Next up keeps its date when the form is re-saved unchanged
    update public.journey_touchpoints set due_date = v_today + 3 where source_activity_id = v_aid and source_seq = 1;
    update public.activities set note_key_points = 'edited', next_actions = next_actions where id = v_aid;
    select due_date into v_d from public.journey_touchpoints where source_activity_id = v_aid and source_seq = 1;
    if v_d = v_today + 3 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'reschedule overwritten'::text; end if;

    -- 3. changing the date in the form moves it; removing row 2 drops its open task
    update public.activities set next_actions = jsonb_build_array(
        jsonb_build_object('text', 'Follow up on RM18,990 package', 'type', 'call', 'due', (v_today + 5)::text)) where id = v_aid;
    select due_date into v_d from public.journey_touchpoints where source_activity_id = v_aid and source_seq = 1;
    select count(*) into v_n from public.journey_touchpoints where source_activity_id = v_aid;
    if v_d = v_today + 5 and v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('edit/remove n=' || v_n); end if;

    -- 4. done → meeting done only when no task is open
    update public.activities set next_actions = next_actions || jsonb_build_array(
        jsonb_build_object('text', 'Send brochure', 'type', 'whatsapp', 'due', (v_today + 2)::text)) where id = v_aid;
    update public.journey_touchpoints set status = 'done' where source_activity_id = v_aid and source_seq = 1;
    select next_action_done into v_done from public.activities where id = v_aid;
    if not coalesce(v_done, false) then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'done while a task is open'::text; end if;
    update public.journey_touchpoints set status = 'skipped' where source_activity_id = v_aid and source_seq = 2;
    select next_action_done into v_done from public.activities where id = v_aid;
    if v_done then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'not done after the last task'::text; end if;
    select status into v_s from public.journey_touchpoints where source_activity_id = v_aid and source_seq = 1;
    if v_s = 'done' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('done task reopened: ' || v_s); end if;

    -- 5. an old single-next-action meeting still works the old way
    insert into public.activities (id, prospect_id, activity_type, activity_title, activity_date, next_action)
    values (v_old, v_pid, 'FTF', 'TEST FTF', v_today - 2, 'Old style step');
    select count(*) into v_n from public.journey_touchpoints where source_activity_id = v_old and source_seq = 0;
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'legacy single task missing'::text; end if;
    -- …and moving it to the list replaces the old task
    update public.activities set next_actions = jsonb_build_array(jsonb_build_object('text', 'New style', 'type', 'other', 'due', (v_today + 4)::text)) where id = v_old;
    select count(*) into v_n from public.journey_touchpoints where source_activity_id = v_old;
    select title into v_t from public.journey_touchpoints where source_activity_id = v_old;
    if v_n = 1 and v_t = '📝 New style' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('legacy→list n=' || v_n); end if;

    -- 6. names.phone exists
    insert into public.names (id, prospect_id, relation, full_name, phone) values (990000000000321, v_pid, 'Friend', 'TEST name', '0123456789');
    select count(*) into v_n from public.names where prospect_id = v_pid and phone = '0123456789';
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'names.phone'::text; end if;

    raise exception 'MINUTES_STEPS_RESULT %', json_build_object('pass', v_pass, 'fail', v_fail, 'failures', v_msgs);
end $$;
