-- Scenario test for migrations/2026-10-28_event_invite_engine.sql — the spec's
-- acceptance tests 1–10 plus the owner's decline / pause rules, on TEST rows.
-- One DO block that ALWAYS raises at the end (everything rolled back, nothing sent).
-- Result: EVENT_INVITE_RESULT {"pass","fail","failures"}
do $$
declare
    v_today  date := public.journey_today();
    v_agent  bigint := (select u.id from public.users u where u.role_level between 3 and 11 and u.auth_user_id is not null
                          and coalesce(u.status, 'active') = 'active' order by u.id limit 1);
    v_other  bigint; v_u uuid; v_u2 uuid;
    v_htx    bigint := (select id from public.products where name like '换天心%' limit 1);
    v_flexi  text := (select name from public.products where subcategory like 'Fengshui Audit · 灵活%' order by name limit 1);
    v_topic  bigint := 990000000000901; v_topic2 bigint := 990000000000902; v_past bigint := 990000000000903;
    v_sess   bigint := 990000000000911; v_sess2 bigint := 990000000000912; v_psess bigint := 990000000000913; v_psess2 bigint := 990000000000914;
    v_ca bigint := 990000000000921; v_pa bigint := 990000000000931; v_pb bigint := 990000000000932; v_pc bigint := 990000000000933;
    v_cd bigint := 990000000000924; v_pe bigint := 990000000000935; v_pf bigint := 990000000000936;
    v_objs jsonb; v_res jsonb; v_n int; v_n2 int; v_s text; v_k text; v_id bigint; v_list jsonb; v_pot numeric;
    v_pass int := 0; v_fail int := 0; v_msgs text[] := '{}';
begin
    v_objs := jsonb_build_array(jsonb_build_object('line', 'fengshui', 'goal', 'decide', 'focus', jsonb_build_array(v_htx)),
                                jsonb_build_object('line', 'fengshui', 'goal', 'upgrade', 'focus', jsonb_build_array(v_htx)));
    select u.id into v_other from public.users u
     where u.role_level between 3 and 11 and u.auth_user_id is not null and u.id <> v_agent
       and v_agent not in (select public.pipeline_tree_ids(u.id, true)) order by u.id limit 1;
    select auth_user_id into v_u from public.users where id = v_agent;
    select auth_user_id into v_u2 from public.users where id = v_other;

    insert into public.prospects (id, full_name, phone, status, responsible_agent_id, open_potential_rm, do_not_invite) values
        (v_pa, 'TEST inv A (Claude)', '+60990000000931', 'converted', v_agent, 0, false),
        (v_pb, 'TEST inv B (Claude)', '+60990000000932', 'active', v_agent, 999999, false),
        (v_pc, 'TEST inv C (Claude)', '+60990000000933', 'active', v_agent, 0, false),
        (v_pe, 'TEST inv E (Claude)', '+60990000000935', 'active', v_agent, 0, false),
        (v_pf, 'TEST inv F (Claude)', '+60990000000936', 'active', v_agent, 0, true);
    insert into public.customers (id, full_name, phone, responsible_agent_id, converted_from_prospect_id) values
        (v_ca, 'TEST inv A (Claude)', '+60990000000921', v_agent, v_pa),
        (v_cd, 'TEST inv D (Claude)', '+60990000000924', v_agent, null);
    insert into public.purchases (id, customer_id, date, item, amount, status) values
        (990000000000941, v_ca, v_today - 100, v_flexi, 8000, 'COMPLETED'),
        (990000000000942, v_cd, v_today - 100, v_flexi, 8000, 'COMPLETED'),
        (990000000000943, v_cd, v_today - 20, '换天心 Huan Tian Xin', 20000, 'COMPLETED');
    insert into public.events (id, title, categories, invite_objectives, invite_slots) values
        (v_topic, 'TEST 天心交喜', '["老板每月主题课"]', v_objs, 20),
        (v_topic2, 'TEST 天心交喜 2', '["老板每月主题课"]', v_objs, 20),
        (v_past, 'TEST 汇集 Condo 专案换天心', '["汇集专案-Condo"]', null, null);
    insert into public.activities (id, activity_type, activity_title, activity_date, event_id, lead_agent_id) values
        (v_sess, 'EVENT', 'TEST 天心交喜', v_today + 5, v_topic, v_agent),
        (v_sess2, 'EVENT', 'TEST 天心交喜 2', v_today + 40, v_topic2, v_agent),
        (v_psess, 'EVENT', 'TEST 汇集 1', v_today - 20, v_past, v_agent),
        (v_psess2, 'EVENT', 'TEST 汇集 2', v_today - 3, v_past, v_agent);
    insert into public.event_attendees (id, event_id, activity_id, attendee_id, entity_id, entity_name, attendee_type, attendance_status, attended, created_at) values
        (990000000000951, v_past, v_psess, v_ca, v_ca, 'A', 'customer', 'Attended', true, now()),
        (990000000000952, v_past, v_psess, v_pc, v_pc, 'C', 'prospect', 'Attended', true, now()),
        (990000000000953, v_past, v_psess, v_pe, v_pe, 'E', 'prospect', 'Attended', true, now()),
        (990000000000954, v_past, v_psess2, v_pe, v_pe, 'E', 'prospect', 'Attended', true, now()),
        (990000000000955, v_past, v_psess, v_pf, v_pf, 'F', 'prospect', 'Attended', true, now()),
        (990000000000956, v_past, v_psess, v_cd, v_cd, 'D', 'customer', 'Attended', true, now()),
        (990000000000957, v_topic, v_sess, v_pc, v_pc, 'C', 'prospect', 'Registered', false, now());
    insert into public.activities (id, activity_type, activity_title, activity_date, prospect_id, lead_agent_id, opportunity_potential)
    values (990000000000961, 'FTF', 'TEST meet B', v_today - 5, v_pb, v_agent, '天至喜1 Tian Zhi Xi 1');

    v_res := public.event_invite_refresh(v_sess, true);

    -- T1 relevant existing customer: strong, reasons, agent
    select grp || '|' || agent_id || '|' || jsonb_array_length(reasons) into v_s from public.event_invites where activity_id = v_sess and person_key = 'c:' || v_ca;
    if split_part(v_s, '|', 1) = 'strong' and split_part(v_s, '|', 2) = v_agent::text and split_part(v_s, '|', 3)::int > 0 then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('T1 ' || coalesce(v_s, 'not listed')); end if;
    -- T2 high value, no topic evidence: not listed
    if not exists (select 1 from public.event_invites where activity_id = v_sess and person_key = 'p:' || v_pb) then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'T2 high-value irrelevant was listed'::text; end if;
    -- T3 already registered: not suggested, still on the attendee list
    if not exists (select 1 from public.event_invites where activity_id = v_sess and person_key = 'p:' || v_pc)
       and exists (select 1 from public.event_attendees where activity_id = v_sess and entity_id = v_pc) then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'T3 registered person suggested'::text; end if;
    -- T4 owns the step below → upgrade; owns the focus product → journey done
    select excl into v_s from public.inv_compute(v_objs, v_sess, 'c:' || v_cd);
    if v_s = 'complete' and exists (select 1 from public.event_invites where activity_id = v_sess and person_key = 'c:' || v_ca and objective = 'fengshui:upgrade')
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('T4 ' || coalesce(v_s, 'null')); end if;
    -- T5 events only: real evidence + data warning, no invented intent
    select reasons::text || warnings::text into v_s from public.event_invites where activity_id = v_sess and person_key = 'p:' || v_pe;
    if v_s like '%Came to%' and v_s like '%only_events%' and v_s not like '%Discussed%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('T5 ' || coalesce(v_s, 'not listed')); end if;
    -- T6 do not invite: held back and counted
    select excl into v_s from public.inv_compute(v_objs, v_sess, 'p:' || v_pf);
    if v_s = 'do_not_invite' and not exists (select 1 from public.event_invites where activity_id = v_sess and person_key = 'p:' || v_pf)
       and coalesce((v_res -> 'excluded' ->> 'do_not_invite')::int, 0) >= 1 then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('T6 ' || coalesce(v_s, 'null')); end if;
    -- T10 same data → same list
    select string_agg(person_key || ':' || slot_rank, ',' order by person_key) into v_k from public.event_invites where activity_id = v_sess;
    delete from public.event_invites where activity_id = v_sess;
    perform public.event_invite_refresh(v_sess, true);
    if (select string_agg(person_key || ':' || slot_rank, ',' order by person_key) from public.event_invites where activity_id = v_sess) = v_k
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'T10 not reproducible'::text; end if;
    -- names per agent cap
    update public.events set invite_slots = 1 where id = v_topic;
    delete from public.event_invites where activity_id = v_sess;
    perform public.event_invite_refresh(v_sess, true);
    select count(*) into v_n from public.event_invites where activity_id = v_sess and agent_id = v_agent and grp in ('strong', 'potential');
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('slots=1 gave ' || v_n); end if;
    update public.events set invite_slots = 20 where id = v_topic;
    delete from public.event_invites where activity_id = v_sess;
    perform public.event_invite_refresh(v_sess, true);

    -- ── as the agent (logged in) ──
    perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_u::text, true);
    execute 'set local role authenticated';
    -- T7 manual add + not suitable: recorded, source record untouched
    select open_potential_rm into v_pot from public.prospects where id = v_pb;
    v_list := public.event_invite_add(v_sess, v_pb, null);
    v_id := (v_list ->> 'id')::bigint;
    perform public.event_invite_act(v_id, 'remove', '{"reason":"not_fit","note":"TEST"}'::jsonb);
    if (select source || state || removed_reason from public.event_invites where id = v_id) = 'manualremovednot_fit'
       and (select open_potential_rm from public.prospects where id = v_pb) = v_pot then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'T7 manual add / not suitable'::text; end if;
    -- decline needs a reason; "not interested" pauses the SAME line+goal only
    select id into v_id from public.event_invites where activity_id = v_sess and person_key = 'c:' || v_ca;
    perform public.event_invite_act(v_id, 'sent', '{"channel":"whatsapp"}'::jsonb);
    begin
        perform public.event_invite_act(v_id, 'reply', '{"reply":"declined"}'::jsonb);
        v_fail := v_fail + 1; v_msgs := v_msgs || 'decline without reason allowed'::text;
    exception when others then v_pass := v_pass + 1; end;
    perform public.event_invite_act(v_id, 'reply', '{"reply":"declined","reason":"not_interested"}'::jsonb);
    execute 'reset role';
    select excl into v_s from public.inv_compute(v_objs, v_sess2, 'c:' || v_ca);
    select excl into v_k from public.inv_compute('[{"line":"calligraphy","goal":"introduce"}]'::jsonb, v_sess2, 'c:' || v_ca);
    if v_s = 'paused' and v_k is null then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('pause same=' || coalesce(v_s, 'null') || ' other=' || coalesce(v_k, 'null')); end if;
    -- "stop inviting me" → do not invite everywhere
    select id into v_id from public.event_invites where activity_id = v_sess and person_key = 'p:' || v_pe;
    execute 'set local role authenticated';
    perform public.event_invite_act(v_id, 'reply', '{"reply":"declined","reason":"stop"}'::jsonb);
    execute 'reset role';
    if (select do_not_invite from public.prospects where id = v_pe) then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'stop did not set do_not_invite'::text; end if;

    -- T9 another agent (not upline) cannot see or act
    if v_u2 is not null then
        perform set_config('request.jwt.claims', json_build_object('sub', v_u2, 'role', 'authenticated')::text, true);
        perform set_config('request.jwt.claim.sub', v_u2::text, true);
        execute 'set local role authenticated';
        v_list := public.event_invite_list(v_sess);
        select count(*) into v_n from jsonb_array_elements(v_list -> 'rows') x where (x ->> 'agent_id')::bigint = v_agent;
        begin
            perform public.event_invite_act(v_id, 'undo', '{}'::jsonb);
            v_n := v_n + 100;
        exception when others then null; end;
        begin
            update public.invite_config set value = value where key = 'rules';
            get diagnostics v_n2 = row_count;
        exception when others then v_n2 := 0; end;
        execute 'reset role';
        if v_n = 0 and v_n2 = 0 then v_pass := v_pass + 1;
        else v_fail := v_fail + 1; v_msgs := v_msgs || ('T9 other agent saw/acted ' || v_n || ' rules ' || v_n2); end if;
    end if;

    -- T8 after the session: came → follow-up task, no-show → review task, once only
    insert into public.event_invites (activity_id, event_id, person_key, customer_id, agent_id, objectives, grp, state, sent_at, reply, attended, no_show)
    values (v_psess2, v_past, 'c:' || v_cd, v_cd, v_agent, '{}', 'strong', 'sent', now(), 'coming', true, false);
    insert into public.event_invites (activity_id, event_id, person_key, prospect_id, agent_id, objectives, grp, state, sent_at, reply, attended, no_show)
    values (v_psess2, v_past, 'p:' || v_pc, v_pc, v_agent, '{}', 'strong', 'sent', now(), 'coming', false, true);
    perform public.event_invite_daily();
    perform public.event_invite_daily();
    select count(*) into v_n from public.journey_touchpoints t join public.event_invites i on i.id = t.source_invite_id where i.activity_id = v_psess2;
    if v_n = 2 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('T8 tasks=' || v_n); end if;

    -- attendance sync: registering + ticking attended moves the invite
    select id into v_id from public.event_invites where activity_id = v_sess and grp in ('strong', 'potential') and state <> 'removed'
       and coalesce(reply, '') <> 'declined' order by id limit 1;
    if v_id is not null then
        insert into public.event_attendees (id, event_id, activity_id, attendee_id, entity_id, entity_name, attendee_type, attendance_status, created_at)
        select 990000000000999, v_topic, v_sess, coalesce(customer_id, prospect_id), coalesce(customer_id, prospect_id), 'x',
               case when customer_id is not null then 'customer' else 'prospect' end, 'Registered', now()
          from public.event_invites where id = v_id;
        update public.event_attendees set attendance_status = 'Attended', attended = true where id = 990000000000999;
        if (select reply || attended::text from public.event_invites where id = v_id) = 'comingtrue' then v_pass := v_pass + 1;
        else v_fail := v_fail + 1; v_msgs := v_msgs || 'attendance sync'::text; end if;
    end if;

    -- helpers
    if public.inv_product_head('换天心 Huan Tian Xin') = '换天心' and public.inv_product_head('天至喜1 Tian Zhi Xi 1') = '天至喜'
       and public.inv_product_head('DC 代理配套') is null and public.inv_hit('came to 汇集 condo', array['汇集']) = '汇集'
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'helpers'::text; end if;

    raise exception 'EVENT_INVITE_RESULT %', json_build_object('pass', v_pass, 'fail', v_fail, 'failures', v_msgs);
end $$;
