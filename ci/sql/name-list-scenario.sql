-- Scenario test for migrations/2026-11-03_name_lists.sql — saved Name Lists:
-- generate (target × 2.5 offered, first <target> ticked, Do not contact held
-- back), the read-only engine output + append-only log, remove needs a reason,
-- Do not contact refused on add / contact, "stop" turns the switch on (stamped
-- + audited), regenerate keeps decisions and never touches V1, team lists split
-- per agent and stay hidden from agents until started (then one push each),
-- agents see / act on only their own rows, outsiders see nothing, a sale counts
-- for ONE list (latest contact wins) and drops out when cancelled, the
-- contacted-often warning → "Add anyway", a list with contact steps deletes
-- whole while the log itself stays locked. Test users + people are created here;
-- one DO block that ALWAYS raises, so everything is rolled back.
-- Result: NAME_LIST_RESULT {"pass","fail","failures"}
do $$
declare
    v_today date := public.journey_today();
    v_tl bigint := 990000000004001; v_a1 bigint := 990000000004002; v_a2 bigint := 990000000004003; v_x bigint := 990000000004004;
    u_tl uuid := '9a000000-0000-4000-8000-000000004001'; u_a1 uuid := '9a000000-0000-4000-8000-000000004002';
    u_a2 uuid := '9a000000-0000-4000-8000-000000004003'; u_x uuid := '9a000000-0000-4000-8000-000000004004';
    v_p bigint[] := array[990000000004101, 990000000004102, 990000000004103, 990000000004104,
                          990000000004105, 990000000004106, 990000000004107];   -- A1's people (P7 = Do not contact)
    v_q bigint[] := array[990000000004201, 990000000004202, 990000000004203];   -- A2's people
    v_list bigint; v_team bigint; v_list2 bigint; v_row bigint; v_row2 bigint; v_r jsonb; v_n int; v_m int; v_s text; v_i int;
    v_pass int := 0; v_fail int := 0; v_msgs text[] := '{}';
begin
    -- ── people + users (all TEST, all rolled back) ──
    insert into public.users (id, full_name, role, role_level, reporting_to, status, auth_user_id) values
        (v_tl, 'TEST NL Leader (Claude)', 'Level 5 Team Leader', 5, null, 'active', u_tl),
        (v_a1, 'TEST NL Agent One (Claude)', 'Level 7 Agent', 7, v_tl, 'active', u_a1),
        (v_a2, 'TEST NL Agent Two (Claude)', 'Level 7 Agent', 7, v_tl, 'active', u_a2),
        (v_x,  'TEST NL Outsider (Claude)', 'Level 7 Agent', 7, null, 'active', u_x);
    for v_i in 1 .. 7 loop
        insert into public.prospects (id, full_name, phone, status, responsible_agent_id, do_not_invite)
        values (v_p[v_i], 'TEST NL P' || v_i || ' (Claude)', '+6099000004' || (100 + v_i), 'active', v_a1, v_i = 7);
    end loop;
    for v_i in 1 .. 3 loop
        insert into public.prospects (id, full_name, phone, status, responsible_agent_id)
        values (v_q[v_i], 'TEST NL Q' || v_i || ' (Claude)', '+6099000004' || (200 + v_i), 'active', v_a2);
    end loop;
    -- General × Introduce: a CPS in the last 60 days (30) + 2 meetings in 90 days (30) = Fit 60
    for v_i in 1 .. 7 loop
        insert into public.activities (id, activity_type, activity_title, activity_date, prospect_id, lead_agent_id, visibility) values
            (990000000004300 + v_i * 3, 'CPS', 'TEST NL cps', v_today - 20, v_p[v_i], v_a1, 'closed'),
            (990000000004301 + v_i * 3, 'FTF', 'TEST NL ftf', v_today - 10, v_p[v_i], v_a1, 'closed'),
            (990000000004302 + v_i * 3, 'FTF', 'TEST NL ftf', v_today - 5, v_p[v_i], v_a1, 'closed');
    end loop;
    for v_i in 1 .. 3 loop
        insert into public.activities (id, activity_type, activity_title, activity_date, prospect_id, lead_agent_id, visibility) values
            (990000000004400 + v_i * 3, 'CPS', 'TEST NL cps', v_today - 20, v_q[v_i], v_a2, 'closed'),
            (990000000004401 + v_i * 3, 'FTF', 'TEST NL ftf', v_today - 10, v_q[v_i], v_a2, 'closed'),
            (990000000004402 + v_i * 3, 'FTF', 'TEST NL ftf', v_today - 5, v_q[v_i], v_a2, 'closed');
    end loop;
    -- P1 also had a call → higher Engaged → ranked first
    insert into public.activities (id, activity_type, activity_title, activity_date, prospect_id, lead_agent_id, visibility)
    values (990000000004390, 'CALL', 'TEST NL call', v_today - 3, v_p[1], v_a1, 'closed');

    create function pg_temp.nl_as(p_uid uuid) returns void language plpgsql as $f$
    begin
        perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
        perform set_config('request.jwt.claim.sub', p_uid::text, true);
        set local role authenticated;
    end $f$;

    -- ── 1. agent makes a list: target 3 → 6 offered (P7 held back), first 3 ticked ──
    perform pg_temp.nl_as(u_a1);
    v_r := public.name_list_create(jsonb_build_object('line', 'general', 'goal', 'introduce', 'purpose', 'promote', 'target_qty', 3, 'name', 'TEST NL list'));
    reset role;
    v_list := (v_r ->> 'id')::bigint;
    select count(*), count(*) filter (where decision = 'selected') into v_n, v_m from public.name_list_rows where list_id = v_list;
    if v_n = 6 and v_m = 3 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('offered/picked ' || v_n || '/' || v_m); end if;
    if not exists (select 1 from public.name_list_rows where list_id = v_list and person_key = 'p:' || v_p[7])
       and (select (held ->> 'do_not_invite')::int from public.name_list_versions where list_id = v_list) = 1 then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'DNI not held back'::text; end if;
    if (select person_key from public.name_list_rows where list_id = v_list and rank = 1) = 'p:' || v_p[1]
       and (select engine_picked from public.name_list_rows where list_id = v_list and rank = 1) then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'rank 1 not P1'::text; end if;
    if not exists (select 1 from public.name_list_rows where list_id = v_list and coalesce(next_step, '') = '') then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'next step missing'::text; end if;
    if (select rules ? 'invite_rules' and rules ? 'name_list_rules' and rules -> 'objectives' -> 0 ->> 'line' = 'general'
          from public.name_list_versions where list_id = v_list) then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'rules snapshot'::text; end if;

    -- ── 2. tables are closed to the API; engine output + log are read-only ──
    perform pg_temp.nl_as(u_a1);
    begin perform count(*) from public.name_list_rows; v_fail := v_fail + 1; v_msgs := v_msgs || 'table readable'::text;
    exception when others then v_pass := v_pass + 1; end;
    reset role;
    begin update public.name_list_rows set fit = 1 where list_id = v_list; v_fail := v_fail + 1; v_msgs := v_msgs || 'engine column editable'::text;
    exception when others then v_pass := v_pass + 1; end;

    select id into v_row from public.name_list_rows where list_id = v_list and person_key = 'p:' || v_p[2];
    -- ── 3. remove needs a reason ──
    perform pg_temp.nl_as(u_a1);
    begin perform public.name_list_decide(v_row, 'removed', null, null); v_fail := v_fail + 1; v_msgs := v_msgs || 'removed without reason'::text;
    exception when others then v_pass := v_pass + 1; end;
    v_r := public.name_list_decide(v_row, 'removed', 'not_fit', 'moved overseas');
    reset role;
    if (select decision = 'removed' and decision_reason = 'not_fit' and decided_by = v_a1 from public.name_list_rows where id = v_row)
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'remove not saved'::text; end if;

    -- ── 4. Do not contact: refused on add, no override ──
    perform pg_temp.nl_as(u_a1);
    begin perform public.name_list_add(v_list, v_p[7], null, 'please', true); v_fail := v_fail + 1; v_msgs := v_msgs || 'DNI added'::text;
    exception when others then v_pass := v_pass + 1; end;
    reset role;
    begin update public.name_list_steps set note = 'x'; v_fail := v_fail + 1; v_msgs := v_msgs || 'log editable'::text;
    exception when others then v_pass := v_pass + 1; end;

    -- ── 5. contact + reply; contact on an unticked person refused ──
    select id into v_row from public.name_list_rows where list_id = v_list and person_key = 'p:' || v_p[1];
    select id into v_row2 from public.name_list_rows where list_id = v_list and decision = 'pending' order by rank limit 1;
    perform pg_temp.nl_as(u_a1);
    perform public.name_list_step(v_row, 'whatsapp', null);
    perform public.name_list_step(v_row, 'interested', 'wants a visit');
    begin perform public.name_list_step(v_row2, 'called', null); v_fail := v_fail + 1; v_msgs := v_msgs || 'contact on unticked'::text;
    exception when others then v_pass := v_pass + 1; end;
    reset role;
    -- "stop" on P3 turns Do not contact on (stamped + audited), then calling is refused
    select id into v_row2 from public.name_list_rows where list_id = v_list and person_key = 'p:' || v_p[3];
    perform pg_temp.nl_as(u_a1);
    perform public.name_list_step(v_row2, 'stop', 'asked us to stop');
    begin perform public.name_list_step(v_row2, 'called', null); v_fail := v_fail + 1; v_msgs := v_msgs || 'called a DNI person'::text;
    exception when others then v_pass := v_pass + 1; end;
    v_r := public.name_list_get(v_list, null);
    reset role;
    if (select do_not_invite and do_not_invite_at is not null and do_not_invite_by = v_a1 from public.prospects where id = v_p[3])
       and exists (select 1 from public.audit_trail where category = 'do_not_contact' and target_id = v_p[3]::text and actor_user_id = v_a1)
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'stop not stamped'::text; end if;
    if (v_r -> 'counts' ->> 'contacted')::int = 1 and (v_r -> 'counts' ->> 'interested')::int = 1
       and (select x ->> 'contact_via' from jsonb_array_elements(v_r -> 'rows') x where (x ->> 'id')::bigint = v_row) = 'whatsapp'
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('counts ' || (v_r -> 'counts')::text); end if;

    -- ── 6. regenerate: removed stays removed, ticked stays ticked, DNI drops, V1 untouched ──
    select count(*) into v_n from public.name_list_rows r join public.name_list_versions v on v.id = r.version_id
     where v.list_id = v_list and v.version_no = 1;
    perform pg_temp.nl_as(u_a1);
    v_r := public.name_list_regenerate(v_list);
    reset role;
    if (v_r ->> 'version')::int = 2 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('regen ' || v_r::text); end if;
    if (select decision from public.name_list_rows where version_id = public.nl_latest_version(v_list) and person_key = 'p:' || v_p[2]) = 'removed'
       and (select decision from public.name_list_rows where version_id = public.nl_latest_version(v_list) and person_key = 'p:' || v_p[1]) = 'selected'
       and not exists (select 1 from public.name_list_rows where version_id = public.nl_latest_version(v_list) and person_key = 'p:' || v_p[3])
       and (select count(*) from public.name_list_rows where version_id = public.nl_latest_version(v_list) and decision = 'selected') = 3
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'regen decisions'::text; end if;
    if (select count(*) from public.name_list_rows r join public.name_list_versions v on v.id = r.version_id
         where v.list_id = v_list and v.version_no = 1) = v_n
       and exists (select 1 from public.name_list_rows r join public.name_list_versions v on v.id = r.version_id
                    where v.list_id = v_list and v.version_no = 1 and r.person_key = 'p:' || v_p[3])
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'V1 changed'::text; end if;
    -- an old version is read-only
    select r.id into v_row2 from public.name_list_rows r join public.name_list_versions v on v.id = r.version_id
     where v.list_id = v_list and v.version_no = 1 and r.person_key = 'p:' || v_p[4];
    perform pg_temp.nl_as(u_a1);
    begin perform public.name_list_decide(v_row2, 'removed', 'handled', null); v_fail := v_fail + 1; v_msgs := v_msgs || 'old version editable'::text;
    exception when others then v_pass := v_pass + 1; end;
    v_r := public.name_list_get(v_list, 1);
    reset role;
    if not (v_r -> 'version' ->> 'latest')::boolean and jsonb_array_length(v_r -> 'rows') = v_n then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'read V1'::text; end if;

    -- ── 7. the leader sees + manages the agent's list; an outsider sees nothing ──
    perform pg_temp.nl_as(u_tl);
    v_r := public.name_list_get(v_list, null);
    reset role;
    if (v_r -> 'list' ->> 'can_manage')::boolean then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'leader cannot manage'::text; end if;
    perform pg_temp.nl_as(u_x);
    begin perform public.name_list_get(v_list, null); v_fail := v_fail + 1; v_msgs := v_msgs || 'outsider sees list'::text;
    exception when others then v_pass := v_pass + 1; end;
    v_r := public.name_list_index();
    reset role;
    if not exists (select 1 from jsonb_array_elements(v_r -> 'lists') x where (x ->> 'id')::bigint = v_list)
       and not (v_r ->> 'can_team')::boolean then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'outsider index'::text; end if;

    -- ── 8. team list: 2 per agent; hidden from agents while draft; start → one push each ──
    perform pg_temp.nl_as(u_a1);
    begin perform public.name_list_create(jsonb_build_object('line', 'general', 'goal', 'introduce', 'target_qty', 2, 'scope', 'team'));
          v_fail := v_fail + 1; v_msgs := v_msgs || 'agent made team list'::text;
    exception when others then v_pass := v_pass + 1; end;
    reset role;
    perform pg_temp.nl_as(u_tl);
    v_s := public.name_list_index() ->> 'can_team';
    v_r := public.name_list_create(jsonb_build_object('line', 'general', 'goal', 'introduce', 'target_qty', 2, 'scope', 'team', 'name', 'TEST NL team'));
    reset role;
    if v_s = 'true' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'leader can_team'::text; end if;
    v_team := (v_r ->> 'id')::bigint;
    if (select count(*) from public.name_list_rows where list_id = v_team and decision = 'selected' and agent_id = v_a1) = 2
       and (select count(*) from public.name_list_rows where list_id = v_team and decision = 'selected' and agent_id = v_a2) = 2
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'team split'::text; end if;
    perform pg_temp.nl_as(u_a2);
    begin perform public.name_list_get(v_team, null); v_fail := v_fail + 1; v_msgs := v_msgs || 'agent sees draft team list'::text;
    exception when others then v_pass := v_pass + 1; end;
    reset role;
    perform pg_temp.nl_as(u_tl);
    perform public.name_list_set(v_team, '{"status":"active"}');
    reset role;
    if (select count(*) from public.notification_outbox where dedupe_key = 'name_list:' || v_team and user_id in (v_a1, v_a2)) = 2
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'start push'::text; end if;
    perform pg_temp.nl_as(u_a2);
    v_r := public.name_list_get(v_team, null);
    reset role;
    if jsonb_array_length(v_r -> 'rows') > 0
       and not exists (select 1 from jsonb_array_elements(v_r -> 'rows') x where (x ->> 'agent_id')::bigint <> v_a2)
       and not (v_r -> 'list' ->> 'can_manage')::boolean
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'agent rows scope'::text; end if;
    select id into v_row2 from public.name_list_rows where list_id = v_team and agent_id = v_a1 and decision = 'selected' limit 1;
    perform pg_temp.nl_as(u_a2);
    begin perform public.name_list_step(v_row2, 'called', null); v_fail := v_fail + 1; v_msgs := v_msgs || 'acted on other agent row'::text;
    exception when others then v_pass := v_pass + 1; end;
    reset role;

    -- ── 9. a sale counts for ONE list (latest contact wins) and drops out when cancelled ──
    perform pg_temp.nl_as(u_a1);
    perform public.name_list_set(v_list, '{"status":"active"}');
    reset role;
    insert into public.purchases (id, prospect_id, date, item, amount, status)
    values (990000000004501, v_p[1], v_today, 'TEST NL item', 1000, 'paid');
    perform pg_temp.nl_as(u_a1);
    v_r := public.name_list_get(v_list, null);
    reset role;
    if (v_r -> 'counts' ->> 'closed')::int = 1 and (v_r -> 'counts' ->> 'revenue')::numeric = 1000
       and (v_r -> 'counts' ->> 'closed_after_contact')::int = 1
       and (select count(*) from public.name_list_sales where purchase_id = 990000000004501) = 1
       and (select list_id from public.name_list_sales where purchase_id = 990000000004501) = v_list
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('sale claim ' || (v_r -> 'counts')::text); end if;
    update public.purchases set status = 'cancelled' where id = 990000000004501;
    perform pg_temp.nl_as(u_a1);
    v_r := public.name_list_index();
    reset role;
    if (select (x -> 'counts' ->> 'closed')::int from jsonb_array_elements(v_r -> 'lists') x where (x ->> 'id')::bigint = v_list) = 0
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'cancelled sale still counted'::text; end if;

    -- ── 10. contacted often → warning, then Add anyway ──
    perform pg_temp.nl_as(u_a1);
    perform public.name_list_step(v_row, 'called', null);   -- P1: WhatsApp + call in 30 days = 2
    v_r := public.name_list_create(jsonb_build_object('line', 'general', 'goal', 'comeback', 'target_qty', 1, 'name', 'TEST NL second'));
    v_list2 := (v_r ->> 'id')::bigint;
    v_r := public.name_list_add(v_list2, v_p[1], null, 'met at dinner', false);
    v_s := v_r ->> 'warn';
    v_r := public.name_list_add(v_list2, v_p[1], null, 'met at dinner', true);
    reset role;
    if v_s is not null and (v_r ->> 'ok')::boolean
       and (select source = 'manual' and decision = 'selected' and add_note = 'met at dinner' and added_by = v_a1
              from public.name_list_rows where id = (v_r ->> 'id')::bigint)
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('add warn ' || coalesce(v_s, 'none')); end if;
    perform pg_temp.nl_as(u_a1);
    v_r := public.name_list_add(v_list2, v_p[1], null, null, true);
    reset role;
    if not (v_r ->> 'ok')::boolean then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'double add'::text; end if;

    -- ── 11. a list with contact steps deletes whole; the log itself stays locked ──
    begin
        delete from public.name_lists where id = v_list;
        if not exists (select 1 from public.name_list_steps where list_id = v_list)
           and not exists (select 1 from public.name_list_rows where list_id = v_list)
           and not exists (select 1 from public.name_list_versions where list_id = v_list)
        then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'list delete left rows'::text; end if;
    exception when others then v_fail := v_fail + 1; v_msgs := v_msgs || ('list delete: ' || sqlerrm); end;
    begin update public.name_list_steps set row_id = null where list_id = v_list2; v_fail := v_fail + 1; v_msgs := v_msgs || 'log row_id editable'::text;
    exception when others then v_pass := v_pass + 1; end;
    begin update public.name_list_steps set note = 'x' where list_id = v_list2; v_fail := v_fail + 1; v_msgs := v_msgs || 'log note editable'::text;
    exception when others then v_pass := v_pass + 1; end;

    raise exception 'NAME_LIST_RESULT %', json_build_object('pass', v_pass, 'fail', v_fail, 'failures', v_msgs);
end $$;
