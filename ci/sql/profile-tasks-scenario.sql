-- Scenario test for migrations/2026-10-25_profile_tasks.sql (one task list).
-- Runs entirely inside one DO block that ALWAYS raises at the end, so every
-- row it writes is rolled back. The raised message carries the results:
--   PROFILE_TASKS_RESULT {"pass": n, "fail": n, "failures": [...]}
do $$
declare
    v_pid  bigint := 990000000000001;
    v_aid  bigint := 990000000000101;
    v_old  bigint := 990000000000102;
    v_ev   bigint := 990000000000103;
    v_att  bigint := 990000000000201;
    v_today date := public.journey_today();
    v_tp   public.journey_touchpoints%rowtype;
    v_n    int;
    v_did  bigint;
    v_pass int := 0;
    v_fail int := 0;
    v_msgs text[] := '{}';
    v_done boolean;
begin
    insert into public.prospects (id, full_name, phone, status, responsible_agent_id)
    values (v_pid, 'TEST profile tasks (Claude)', '+60990000000001', 'active', null);

    -- 1. meeting with a next action → one task
    insert into public.activities (id, prospect_id, activity_type, activity_title, activity_date, next_action)
    values (v_aid, v_pid, 'CPS', 'TEST CPS', v_today - 2, '九星课, 改命会 | Remarks: call his wife');
    select * into v_tp from public.journey_touchpoints where source_activity_id = v_aid;
    if v_tp.id is not null then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'no task for meeting'::text; end if;
    if v_tp.title = '📝 九星课, 改命会 — call his wife' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('title ' || coalesce(v_tp.title, 'null')); end if;
    if v_tp.due_date = v_today + 5 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('due ' || coalesce(v_tp.due_date::text, 'null')); end if;
    if v_tp.status = 'pending' and v_tp.prospect_id = v_pid and v_tp.customer_id is null and v_tp.source_kind = 'meeting' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'task fields'::text; end if;

    -- 2. a "by when" date moves the task
    update public.activities set next_action_due = v_today + 10 where id = v_aid;
    select due_date into v_tp.due_date from public.journey_touchpoints where source_activity_id = v_aid;
    if v_tp.due_date = v_today + 10 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'due not moved'::text; end if;

    -- 3. re-saving the meeting with the same date keeps a rescheduled task
    update public.journey_touchpoints set due_date = v_today + 3 where source_activity_id = v_aid;
    update public.activities set note_key_points = 'edited', next_action = next_action where id = v_aid;
    select due_date into v_tp.due_date from public.journey_touchpoints where source_activity_id = v_aid;
    if v_tp.due_date = v_today + 3 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'reschedule overwritten'::text; end if;

    -- 4. new wording → same task, new title (never a second task)
    update public.activities set next_action = 'Arrange next discussion with wife' where id = v_aid;
    select count(*) into v_n from public.journey_touchpoints where source_activity_id = v_aid;
    select title into v_tp.title from public.journey_touchpoints where source_activity_id = v_aid;
    if v_n = 1 and v_tp.title = '📝 Arrange next discussion with wife' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('retitle n=' || v_n); end if;

    -- 5. task done → meeting ticked; meeting unticked → task open again
    update public.journey_touchpoints set status = 'done' where source_activity_id = v_aid;
    select next_action_done into v_done from public.activities where id = v_aid;
    if v_done then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'done not synced back'::text; end if;
    update public.activities set next_action_done = false where id = v_aid;
    select status into v_tp.status from public.journey_touchpoints where source_activity_id = v_aid;
    if v_tp.status = 'pending' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('reopen ' || v_tp.status); end if;

    -- 6. next action cleared → open task removed
    update public.activities set next_action = '' where id = v_aid;
    select count(*) into v_n from public.journey_touchpoints where source_activity_id = v_aid;
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'cleared task kept'::text; end if;

    -- 7. a meeting older than 90 days with no date makes no task
    insert into public.activities (id, prospect_id, activity_type, activity_title, activity_date, next_action)
    values (v_old, v_pid, 'FTF', 'TEST old FTF', v_today - 200, 'old follow up');
    select count(*) into v_n from public.journey_touchpoints where source_activity_id = v_old;
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'old meeting made a task'::text; end if;

    -- 8. deals: auto draft → none; person-saved copy of a meeting task → none; own words → task
    update public.activities set next_action = 'Invite to 汇集' where id = v_aid;   -- open meeting task again
    insert into public.pipeline_deals (prospect_id, agent_id, product, amount, expected_close_date, stage, next_step, auto_created)
    values (v_pid, (select id from public.users order by id limit 1), 'TEST product', 1000, v_today + 30, 'interested', 'Invite to 汇集', true)
    returning id into v_did;
    select count(*) into v_n from public.journey_touchpoints where source_deal_id = v_did;
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'auto deal made a task'::text; end if;
    update public.pipeline_deals set auto_created = false where id = v_did;
    select count(*) into v_n from public.journey_touchpoints where source_deal_id = v_did;
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'deal duplicated a meeting task'::text; end if;
    update public.pipeline_deals set next_step = 'Send the PR3 quotation', next_step_date = v_today + 2 where id = v_did;
    select * into v_tp from public.journey_touchpoints where source_deal_id = v_did;
    if v_tp.id is not null and v_tp.due_date = v_today + 2 and v_tp.source_kind = 'deal' and v_tp.status = 'pending' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'deal task missing'::text; end if;
    update public.pipeline_deals set stage = 'won' where id = v_did;
    select status into v_tp.status from public.journey_touchpoints where source_deal_id = v_did;
    if v_tp.status = 'done' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('won deal task ' || coalesce(v_tp.status, 'null')); end if;

    -- 9. event attendance with a next action → task; task done → attendee ticked
    insert into public.activities (id, activity_type, activity_title, activity_date)
    values (v_ev, 'EVENT', 'TEST event', v_today - 1);
    insert into public.event_attendees (id, activity_id, attendee_type, entity_id, entity_name, next_action)
    values (v_att, v_ev, 'prospect', v_pid, 'TEST', 'Book FSA');
    select * into v_tp from public.journey_touchpoints where source_attendee_id = v_att;
    if v_tp.id is not null and v_tp.prospect_id = v_pid and v_tp.due_date = v_today + 6 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'attendee task'::text; end if;
    update public.journey_touchpoints set status = 'skipped' where source_attendee_id = v_att;
    select next_action_done into v_done from public.event_attendees where id = v_att;
    if v_done then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'attendee done not synced'::text; end if;

    -- 10. title helper
    if public.task_title_from_next_action(' | Remarks: call') = '📝 call' and public.task_title_from_next_action('  ') is null then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'title helper'::text; end if;

    raise exception 'PROFILE_TASKS_RESULT %', json_build_object('pass', v_pass, 'fail', v_fail, 'failures', v_msgs);
end $$;
