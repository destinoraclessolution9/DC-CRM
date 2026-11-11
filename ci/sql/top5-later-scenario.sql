-- Scenario test for migrations/2026-11-11_top5_later.sql (⏰ Later / ✕ Not now,
-- RM30k cap, fatigue, "met" vs "last contact", leaders still see hidden rows).
-- One DO block that ALWAYS raises at the end (all rolled back).
-- Result: TOP5_LATER_RESULT {"pass","fail","failures"}
-- Before the migration is applied, run both in ONE rolled-back statement: an
-- outer DO block that EXECUTEs the migration (minus begin/commit), then this file.
do $$
declare
    v_agent bigint;
    v_auth  uuid;
    v_today date := public.journey_today();
    v_p1 bigint := 990000000011001;   -- audit RM168k, last contact = a CALL
    v_p2 bigint := 990000000011002;   -- hot RM20k, met at an FTF with no minutes yet
    k1 text; k2m text;
    v_until date; v_b boolean; v_n int; v_sc numeric; v_s text; v_s2 text; v_why text;
    v_pass int := 0; v_fail int := 0; v_msgs text[] := '{}';
begin
    select u.id, u.auth_user_id into v_agent, v_auth from public.users u
     where u.role_level between 3 and 12 and u.auth_user_id is not null
       and coalesce(u.status, 'active') !~* 'inactive|deleted|resign|terminat'
     order by u.id limit 1;

    insert into public.prospects (id, full_name, phone, status, responsible_agent_id) values
        (v_p1, 'TEST Top5 Big (Claude)', '+60990000011001', 'active', v_agent),
        (v_p2, 'TEST Top5 Met (Claude)', '+60990000011002', 'active', v_agent);
    insert into public.activities (id, prospect_id, activity_type, activity_title, activity_date, lead_agent_id) values
        (990000000011101, v_p1, 'CALL', 'TEST call', v_today - 10, v_agent),
        (990000000011102, v_p2, 'FTF', 'TEST ftf', v_today - 5, v_agent);
    -- the triggers recomputed the tier from real data (none) — set the case by hand
    update public.prospects set potential_tier = 'audit', open_potential_rm = 168000,
           potential_last_met = v_today - 10, potential_next_booked = null where id = v_p1;
    update public.prospects set potential_tier = 'hot', open_potential_rm = 20000,
           potential_last_met = v_today - 5, potential_next_booked = null where id = v_p2;
    k1  := public.journey_todo_key('book', v_p1, null, null);
    k2m := public.journey_todo_key('minutes', v_p2, null, 990000000011102);

    perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);

    -- 1. RM30k cap: 30000 × audit 2 × (1 + 10/60) = 70000 (was 168000 × … = 392000)
    select score, why into v_sc, v_s from public.journey_daily_todo(200) where prospect_id = v_p1;
    if v_sc = 70000 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('cap score ' || coalesce(v_sc::text, 'missing')); end if;
    -- 2. a CALL is "last contact", an FTF is "met"
    if v_s like '%nothing booked · last contact %' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('call label ' || coalesce(v_s, 'missing')); end if;

    -- 3. ⏰ Later: gone from my list for 7 days, back on day 7
    v_until := public.journey_todo_hide('book', v_p1, null, null, 'later');
    if v_until = v_today + 7 and not exists (select 1 from public.journey_daily_todo(200) where prospect_id = v_p1)
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('later ' || coalesce(v_until::text, '-')); end if;
    -- … the leader still sees it, marked
    select hidden_until::text || '/' || hidden_action into v_s from public.journey_todo_rows(v_agent, 200, false) where prospect_id = v_p1;
    if v_s = (v_today + 7)::text || '/later' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('leader view ' || coalesce(v_s, 'missing')); end if;
    select hidden_until::text into v_s from public.journey_todo_list(array[v_agent], 200) where prospect_id = v_p1;
    if v_s = (v_today + 7)::text then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('journey_todo_list ' || coalesce(v_s, 'missing')); end if;
    -- … the counts still include it
    select todo_n into v_n from public.journey_todo_counts(array[v_agent]);
    if v_n >= 2 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('counts ' || coalesce(v_n::text, '-')); end if;
    -- … and it is back once the date comes (hide until today = not hidden)
    update public.todo_snoozes set until = v_today where user_id = v_agent and row_key = k1;
    if exists (select 1 from public.journey_daily_todo(200) where prospect_id = v_p1) then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'not back on its day'::text; end if;

    -- 4. ✕ Not now = 30 days; hiding again just moves the date
    v_until := public.journey_todo_hide('book', v_p1, null, null, 'not_now');
    select count(*) into v_n from public.todo_snoozes where user_id = v_agent and row_key = k1;
    if v_until = v_today + 30 and v_n = 1 then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('not now ' || coalesce(v_until::text, '-') || ' rows ' || v_n); end if;

    -- 5. Undo brings it back now; a second undo finds nothing
    v_b := public.journey_todo_unhide('book', v_p1, null, null);
    if v_b and exists (select 1 from public.journey_daily_todo(200) where prospect_id = v_p1)
       and not public.journey_todo_unhide('book', v_p1, null, null)
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'undo'::text; end if;

    -- 6. hiding one row of a person lets their next row show (minutes → book)
    select kind into v_s from public.journey_daily_todo(200) where prospect_id = v_p2;
    perform public.journey_todo_hide('minutes', v_p2, null, 990000000011102, 'later');
    select kind, why into v_s2, v_why from public.journey_daily_todo(200) where prospect_id = v_p2;
    if v_s = 'minutes' and v_s2 = 'book' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('next row ' || coalesce(v_s, '-') || ' → ' || coalesce(v_s2, 'none')); end if;
    -- … and that meeting was an FTF, so it reads "met"
    if v_why like '%nothing booked · met %' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('meet label ' || coalesce(v_why, 'missing')); end if;

    -- 7. fatigue: 3 of the last 7 mornings → ×0.5; 5 → ×0.125; today's own push does not count
    insert into public.todo_shown (user_id, day, row_key)
    select v_agent, v_today - g, k1 from generate_series(0, 3) g on conflict do nothing;   -- today + 3 days back
    select score into v_sc from public.journey_daily_todo(200) where prospect_id = v_p1;
    if v_sc = 35000 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('fatigue 3 ' || coalesce(v_sc::text, 'missing')); end if;
    insert into public.todo_shown (user_id, day, row_key)
    select v_agent, v_today - g, k1 from generate_series(4, 5) g on conflict do nothing;
    select score into v_sc from public.journey_daily_todo(200) where prospect_id = v_p1;
    if v_sc = 8750 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('fatigue 5 ' || coalesce(v_sc::text, 'missing')); end if;
    -- … the leader's view is not tired
    select score into v_sc from public.journey_todo_rows(v_agent, 200, false) where prospect_id = v_p1;
    if v_sc = 70000 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('leader score ' || coalesce(v_sc::text, 'missing')); end if;
    -- … older than 7 days does not count
    delete from public.todo_shown where user_id = v_agent and row_key = k1;
    insert into public.todo_shown (user_id, day, row_key)
    select v_agent, v_today - g, k1 from generate_series(8, 12) g;
    select score into v_sc from public.journey_daily_todo(200) where prospect_id = v_p1;
    if v_sc = 70000 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('old history ' || coalesce(v_sc::text, 'missing')); end if;

    -- 8. guards
    begin
        perform public.journey_todo_hide('nonsense', v_p1, null, null, 'later');
        v_fail := v_fail + 1; v_msgs := v_msgs || 'bad kind accepted'::text;
    exception when sqlstate '22023' then v_pass := v_pass + 1;
    end;
    begin
        perform public.journey_todo_hide('book', v_p1, null, null, 'forever');
        v_fail := v_fail + 1; v_msgs := v_msgs || 'bad action accepted'::text;
    exception when sqlstate '22023' then v_pass := v_pass + 1;
    end;
    v_until := public.journey_todo_hide('book', v_p1, null, null, 'later', 500);
    if v_until = v_today + 90 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('days cap ' || coalesce(v_until::text, '-')); end if;
    perform public.journey_todo_unhide('book', v_p1, null, null);
    perform set_config('request.jwt.claims', '{}', true);
    begin
        perform public.journey_todo_hide('book', v_p1, null, null, 'later');
        v_fail := v_fail + 1; v_msgs := v_msgs || 'signed-out hide accepted'::text;
    exception when sqlstate '42501' then v_pass := v_pass + 1;
    end;

    -- 9. the morning push records what it showed (twice in a row is fine)
    delete from public.todo_shown where user_id = v_agent;
    perform public.queue_daily_todo_push();
    perform public.queue_daily_todo_push();
    select count(*) into v_n from public.todo_shown where user_id = v_agent and day = v_today;
    if v_n between 1 and 5 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('push history ' || v_n); end if;
    if exists (select 1 from public.notification_outbox where user_id = v_agent and kind = 'daily_todo' and dedupe_key = 'daily_todo:' || v_today)
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'push row'::text; end if;
    -- … a row pushed today is not tired today
    select score into v_sc from public.journey_todo_for(v_agent, 200) where prospect_id = v_p1;
    if v_sc = 70000 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('same-day ' || coalesce(v_sc::text, 'missing')); end if;

    -- 10. signatures the old callers rely on are unchanged
    select count(*) into v_n from public.journey_todo_for(v_agent, 5);
    if v_n between 1 and 5 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('limit ' || v_n); end if;

    raise exception 'TOP5_LATER_RESULT %', json_build_object('pass', v_pass, 'fail', v_fail, 'failures', v_msgs, 'agent', v_agent);
end $$;
