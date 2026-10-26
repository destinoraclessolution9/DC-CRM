-- Scenario test for migrations/2026-10-26_festival_wishes.sql. One DO block
-- that ALWAYS raises at the end (everything rolled back, no notification sent).
-- Result: FESTIVAL_RESULT {"pass","fail","failures"}
do $$
declare
    v_pa   bigint := 990000000000501;   -- active prospect
    v_pb   bigint := 990000000000502;   -- blank-status prospect
    v_pc   bigint := 990000000000503;   -- converted prospect (left out)
    v_pd   bigint := 990000000000504;   -- no phone (left out)
    v_pe   bigint := 990000000000505;   -- someone else's prospect
    v_cu   bigint := 990000000000511;   -- customer
    v_agent bigint;
    v_other bigint;
    v_auth uuid;
    v_day  date := '2027-02-04';
    v_n int; v_b boolean; v_msg text; v_t text;
    v_pass int := 0; v_fail int := 0; v_msgs text[] := '{}';
begin
    select id, auth_user_id into v_agent, v_auth from public.users where auth_user_id is not null order by id limit 1;
    select id into v_other from public.users where id <> v_agent order by id limit 1;
    perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);

    insert into public.prospects (id, full_name, phone, status, responsible_agent_id) values
        (v_pa, 'TEST fest A (Claude)', '+60990000000501', 'active', v_agent),
        (v_pb, 'TEST fest B (Claude)', '+60990000000502', null, v_agent),
        (v_pc, 'TEST fest C (Claude)', '+60990000000503', 'converted', v_agent),
        (v_pd, 'TEST fest D (Claude)', '  ', 'active', v_agent),
        (v_pe, 'TEST fest E (Claude)', '+60990000000505', 'active', v_other);
    insert into public.customers (id, full_name, phone, status, responsible_agent_id) values
        (v_cu, 'TEST fest Cust (Claude)', '+60990000000511', 'active', v_agent);

    -- 1. dates: 立春 2027 + 冬至 2026 seeded; 3 catch-up days, then closed
    if (public.festival_current('2027-02-04')).kind = 'lichun' and (public.festival_current('2027-02-07')).kind = 'lichun'
       and (public.festival_current('2027-02-08')).day is null and (public.festival_current('2027-02-03')).day is null
       and (public.festival_current('2026-12-22')).kind = 'dongzhi'
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'festival window'::text; end if;

    -- 2. people: customer + active + blank prospects; not converted / no phone / others'
    select count(*) into v_n from public.festival_people_for(v_agent, v_day) x
     where x.prospect_id in (v_pa, v_pb, v_pc, v_pd, v_pe) or x.customer_id = v_cu;
    if v_n = 3 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('people ' || v_n); end if;

    -- 3. the signed-in agent's list carries the 立春 wording; empty outside a festival
    select count(*), min(x.message), min(x.label) into v_n, v_msg, v_t from public.festival_wish_list(v_day) x
     where x.prospect_id in (v_pa, v_pb) or x.customer_id = v_cu;
    if v_n = 3 and v_t = '立春' and v_msg = (select message_template from public.journey_templates where id = 139)
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('list ' || v_n || ' ' || coalesce(v_t, '-')); end if;
    select count(*) into v_n from public.festival_wish_list('2027-03-01');
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('off-day list ' || v_n); end if;

    -- 4. the year's flying-star text is added under the greeting
    update public.festival_days set extra_message = 'TEST 飞星' where day = v_day;
    select min(x.message) into v_msg from public.festival_wish_list(v_day) x where x.prospect_id = v_pa;
    if v_msg like '%' || E'\n\nTEST 飞星' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'extra message'::text; end if;

    -- 5. tick: own person once (idempotent); someone else's refused
    v_b := public.festival_wish_mark(v_day, v_pa, null);
    perform public.festival_wish_mark(v_day, v_pa, null);
    select count(*) into v_n from public.festival_wishes where festival_day = v_day and prospect_id = v_pa;
    if v_b and v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('mark ' || v_n); end if;
    v_b := public.festival_wish_mark(v_day, v_pe, null);
    if not v_b then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'marked another agent''s person'::text; end if;
    v_b := public.festival_wish_mark(v_day, null, v_cu);
    select bool_and(x.sent) into v_b from public.festival_wish_list(v_day) x where x.prospect_id = v_pa or x.customer_id = v_cu;
    if v_b then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'sent flag'::text; end if;

    -- 6. push only on the day itself, one per agent
    delete from public.notification_outbox where kind = 'festival';
    perform public.queue_festival_push();   -- today is not a festival in CI
    select count(*) into v_n from public.notification_outbox where kind = 'festival';
    if v_n = 0 or public.journey_today() in (select day from public.festival_days) then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('push off-day ' || v_n); end if;
    insert into public.festival_days (day, kind, label) values (public.journey_today(), 'dongzhi', '冬至') on conflict (day) do nothing;
    perform public.queue_festival_push();
    perform public.queue_festival_push();
    select count(*), min(title) into v_n, v_t from public.notification_outbox where kind = 'festival' and user_id = v_agent;
    if v_n = 1 and v_t like '🌙 冬至 today — % to wish' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('push ' || v_n || ' ' || coalesce(v_t, '-')); end if;

    raise exception 'FESTIVAL_RESULT %', json_build_object('pass', v_pass, 'fail', v_fail, 'failures', v_msgs);
end $$;
