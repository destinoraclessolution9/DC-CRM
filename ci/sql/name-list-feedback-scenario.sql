-- Scenario test for migrations/2026-11-05_name_list_feedback.sql — "Not right?"
-- notes: a note on an engine row (with or without taking them off; the CRM's
-- view is copied in), "why missed" on a row added by hand, bad input refused,
-- outsiders refused, notes cannot be edited, rows carry their notes, the
-- Accuracy report for the owner + their upline (not outsiders), and a list
-- with notes still deletes whole. One DO block that ALWAYS raises: rolled back.
-- Result: NAME_LIST_FEEDBACK_RESULT {"pass","fail","failures"}
do $$
declare
    v_today date := public.journey_today();
    v_tl bigint := 990000000006001; v_a1 bigint := 990000000006002; v_x bigint := 990000000006004;
    u_tl uuid := '9c000000-0000-4000-8000-000000006001'; u_a1 uuid := '9c000000-0000-4000-8000-000000006002';
    u_x uuid := '9c000000-0000-4000-8000-000000006004';
    v_p bigint[] := array[990000000006101, 990000000006102, 990000000006103, 990000000006104, 990000000006105, 990000000006106];
    v_list bigint; v_r jsonb; v_row1 bigint; v_row2 bigint; v_row6 bigint; v_i int; v_f public.name_list_feedback;
    v_pass int := 0; v_fail int := 0; v_msgs text[] := '{}';
begin
    insert into public.users (id, full_name, role, role_level, reporting_to, status, auth_user_id) values
        (v_tl, 'TEST NLF Leader (Claude)', 'Level 5 Team Leader', 5, null, 'active', u_tl),
        (v_a1, 'TEST NLF Agent (Claude)', 'Level 7 Agent', 7, v_tl, 'active', u_a1),
        (v_x,  'TEST NLF Outsider (Claude)', 'Level 7 Agent', 7, null, 'active', u_x);
    for v_i in 1 .. 6 loop
        insert into public.prospects (id, full_name, phone, status, responsible_agent_id)
        values (v_p[v_i], 'TEST NLF P' || v_i || ' (Claude)', '+6099000006' || (100 + v_i), 'active', v_a1);
    end loop;
    -- P1–P5: General × Introduce fit 60 (CPS in 60 days + 2 meetings in 90); P6: nothing (the CRM misses them)
    for v_i in 1 .. 5 loop
        insert into public.activities (id, activity_type, activity_title, activity_date, prospect_id, lead_agent_id, visibility) values
            (990000000006300 + v_i * 3, 'CPS', 'TEST NLF cps', v_today - 20, v_p[v_i], v_a1, 'closed'),
            (990000000006301 + v_i * 3, 'FTF', 'TEST NLF ftf', v_today - 10, v_p[v_i], v_a1, 'closed'),
            (990000000006302 + v_i * 3, 'FTF', 'TEST NLF ftf', v_today - 5, v_p[v_i], v_a1, 'closed');
    end loop;

    create function pg_temp.nlf_as(p_uid uuid) returns void language plpgsql as $f$
    begin
        perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
        perform set_config('request.jwt.claim.sub', p_uid::text, true);
        set local role authenticated;
    end $f$;

    perform pg_temp.nlf_as(u_a1);
    v_r := public.name_list_create('{"purpose": "promote", "line": "general", "goal": "introduce", "target_qty": 3, "name": "TEST NLF list"}');
    reset role;
    v_list := (v_r ->> 'id')::bigint;
    select id into v_row1 from public.name_list_rows where list_id = v_list and person_key = 'p:' || v_p[1];
    select id into v_row2 from public.name_list_rows where list_id = v_list and person_key = 'p:' || v_p[2];

    -- ── 1. "Not right" + take off: removed with the note as the reason, CRM view copied ──
    perform pg_temp.nlf_as(u_a1);
    v_r := public.name_list_feedback(v_row1, 'owns_more', 'bought a 2nd one in Oct', true);
    reset role;
    select * into v_f from public.name_list_feedback where id = (v_r ->> 'id')::bigint;
    if v_f.kind = 'wrong' and v_f.took_off and v_f.note = 'bought a 2nd one in Oct' and v_f.by_id = v_a1
       and (v_f.engine ->> 'fit')::int = 60 and jsonb_array_length(v_f.engine -> 'reasons') > 0 and v_f.engine ->> 'goal' = 'introduce'
       and (select decision = 'removed' and decision_reason = 'not_fit' and decision_note like 'Not right — Already owns more than shown%'
              from public.name_list_rows where id = v_row1)
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('take-off note ' || coalesce(v_r::text, '')); end if;

    -- ── 2. "Not right" but kept: the row stays as it was ──
    perform pg_temp.nlf_as(u_a1);
    v_r := public.name_list_feedback(v_row2, 'wrong_reason', 'met at a wedding, not a CPS', false);
    reset role;
    if not (v_r ->> 'took_off')::boolean
       and (select decision from public.name_list_rows where id = v_row2) <> 'removed'
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'kept row changed'::text; end if;

    -- ── 3. bad input refused ──
    perform pg_temp.nlf_as(u_a1);
    begin perform public.name_list_feedback(v_row2, 'other', '  ', false); v_fail := v_fail + 1; v_msgs := v_msgs || 'other without comment'::text;
    exception when others then v_pass := v_pass + 1; end;
    begin perform public.name_list_feedback(v_row2, 'nonsense', null, false); v_fail := v_fail + 1; v_msgs := v_msgs || 'unknown reason'::text;
    exception when others then v_pass := v_pass + 1; end;
    begin perform public.name_list_feedback(v_row2, 'should_match', null, false); v_fail := v_fail + 1; v_msgs := v_msgs || 'missed reason on engine row'::text;
    exception when others then v_pass := v_pass + 1; end;
    reset role;

    -- ── 4. added by hand → "why missed" (and only missed reasons) ──
    perform pg_temp.nlf_as(u_a1);
    v_r := public.name_list_add(v_list, v_p[6], null, 'neighbour, keen', true);
    v_row6 := (v_r ->> 'id')::bigint;
    v_r := public.name_list_feedback(v_row6, 'not_recorded', 'keen but nothing logged', false);
    begin perform public.name_list_feedback(v_row6, 'owns_more', null, false); v_fail := v_fail + 1; v_msgs := v_msgs || 'wrong reason on manual row'::text;
    exception when others then v_pass := v_pass + 1; end;
    reset role;
    if (select kind = 'missed' and reason = 'not_recorded' and engine ->> 'source' = 'manual' from public.name_list_feedback where id = (v_r ->> 'id')::bigint)
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'missed note'::text; end if;

    -- ── 5. an outsider cannot write a note ──
    perform pg_temp.nlf_as(u_x);
    begin perform public.name_list_feedback(v_row2, 'not_mine', null, false); v_fail := v_fail + 1; v_msgs := v_msgs || 'outsider wrote a note'::text;
    exception when others then v_pass := v_pass + 1; end;
    reset role;

    -- ── 6. notes cannot be edited; the table is closed to the API ──
    begin update public.name_list_feedback set note = 'x' where list_id = v_list; v_fail := v_fail + 1; v_msgs := v_msgs || 'note edited'::text;
    exception when others then v_pass := v_pass + 1; end;
    if not has_table_privilege('authenticated', 'public.name_list_feedback', 'select')
       and not has_function_privilege('anon', 'public.name_list_feedback(bigint,text,text,boolean)', 'execute')
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'table/API open'::text; end if;

    -- ── 7. rows carry their notes ──
    perform pg_temp.nlf_as(u_a1);
    v_r := public.name_list_get(v_list, null);
    reset role;
    if exists (select 1 from jsonb_array_elements(v_r -> 'rows') x
                where x ->> 'person_key' = 'p:' || v_p[1] and x -> 'feedback' -> 0 ->> 'reason' = 'owns_more'
                  and x -> 'feedback' -> 0 ->> 'by' = 'TEST NLF Agent (Claude)')
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'row notes missing'::text; end if;

    -- ── 8. Accuracy report: owner sees counts + notes (CRM view beside the comment) ──
    perform pg_temp.nlf_as(u_a1);
    v_r := public.name_list_feedback_report();
    reset role;
    if exists (select 1 from jsonb_array_elements(v_r -> 'lists') x
                where (x ->> 'id')::bigint = v_list and (x ->> 'wrong')::int = 2 and (x ->> 'missed')::int = 1 and (x ->> 'added')::int = 1
                  and (x -> 'by_reason' ->> 'owns_more')::int = 1)
       and (select count(*) from jsonb_array_elements(v_r -> 'notes') n where (n ->> 'list_id')::bigint = v_list) = 3
       and exists (select 1 from jsonb_array_elements(v_r -> 'notes') n where n ->> 'reason' = 'owns_more'
                     and jsonb_array_length(n -> 'crm_said') > 0 and n ->> 'label' = 'Already owns more than shown')
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('owner report ' || left(v_r::text, 300)); end if;

    -- ── 9. the owner's upline sees it; an outsider does not ──
    perform pg_temp.nlf_as(u_tl);
    v_r := public.name_list_feedback_report();
    reset role;
    if exists (select 1 from jsonb_array_elements(v_r -> 'lists') x where (x ->> 'id')::bigint = v_list)
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'upline report missing'::text; end if;
    perform pg_temp.nlf_as(u_x);
    v_r := public.name_list_feedback_report();
    reset role;
    if not exists (select 1 from jsonb_array_elements(v_r -> 'lists') x where (x ->> 'id')::bigint = v_list)
       and not exists (select 1 from jsonb_array_elements(v_r -> 'notes') n where (n ->> 'list_id')::bigint = v_list)
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'outsider sees report'::text; end if;

    -- ── 10. a list with notes still deletes whole ──
    begin
        delete from public.name_lists where id = v_list;
        if not exists (select 1 from public.name_list_feedback where list_id = v_list) then v_pass := v_pass + 1;
        else v_fail := v_fail + 1; v_msgs := v_msgs || 'notes left after delete'::text; end if;
    exception when others then v_fail := v_fail + 1; v_msgs := v_msgs || ('delete: ' || sqlerrm); end;

    raise exception 'NAME_LIST_FEEDBACK_RESULT %', json_build_object('pass', v_pass, 'fail', v_fail, 'failures', v_msgs);
end $$;
