-- Scenario test for migrations/2026-11-02_cps_cancel_lock.sql — the 14-day cancel
-- lock and the date lock that goes with it. One DO block that ALWAYS raises (all
-- rolled back). Result: CPS_LOCK_RESULT {"pass","fail","failures"}
do $$
declare
    v_today date := public.journey_today();
    v_agent bigint; v_lead bigint; v_admin bigint; v_mm bigint; v_ua uuid; v_ul uuid; v_uad uuid; v_um uuid;
    p0 constant bigint := 990000000005100;
    c0 constant bigint := 990000000005120;
    c_d13 bigint := c0 + 1; c_d14 bigint := c0 + 2; c_d40 bigint := c0 + 3; c_soon bigint := c0 + 4;
    c_move bigint := c0 + 5; c_min bigint := c0 + 6; c_close bigint := c0 + 7; c_form bigint := c0 + 8;
    c_cust bigint := c0 + 9; c_d13m bigint := c0 + 10; c_fix bigint := c0 + 11; c_ftf bigint := c0 + 12;
    c_stale bigint := c0 + 13;
    v_r jsonb; v_n int; v_s text; v_d date; v_id bigint; v_t text;
    v_pass int := 0; v_fail int := 0; v_msgs text[] := '{}';
begin
    select a.id, b.id, a.auth_user_id, b.auth_user_id into v_agent, v_lead, v_ua, v_ul
      from public.users a join public.users b on b.id = a.reporting_to
     where a.auth_user_id is not null and b.auth_user_id is not null and a.role_level between 6 and 11 and b.role_level between 3 and 10
     order by a.id limit 1;
    select id, auth_user_id into v_admin, v_uad from public.users where role ~* 'Level\s+1\y' and auth_user_id is not null order by id limit 1;
    -- nobody holds L2 with a login today: lend the level to someone in this block
    select id, auth_user_id into v_mm, v_um from public.users
     where auth_user_id is not null and role_level between 6 and 11 and id not in (v_agent, v_lead) order by id limit 1;
    update public.users set role = 'Level 2 Marketing Manager', role_level = 2 where id = v_mm;
    if v_agent is null or v_admin is null or v_mm is null then raise exception 'CPS_LOCK_RESULT setup: users missing'; end if;

    insert into public.prospects (id, full_name, phone, status, responsible_agent_id)
    select p0 + g, 'TEST lock ' || g || ' (Claude)', '+6099000005' || (100 + g), 'active', v_agent from generate_series(1, 13) g;
    update public.prospects set cps_form_date = v_today - 40 where id = p0 + 8;
    update public.prospects set status = 'converted' where id = p0 + 9;
    insert into public.activities (id, activity_type, activity_title, activity_date, start_time, venue, prospect_id, lead_agent_id, visibility) values
        (c_d13, 'CPS', 'TEST day 13', v_today - 13, '15:00', 'TEST venue', p0 + 1, v_agent, 'closed'),
        (c_d14, 'CPS', 'TEST day 14', v_today - 14, '15:00', 'TEST venue', p0 + 2, v_agent, 'closed'),
        (c_d40, 'CPS', 'TEST day 40', v_today - 40, '15:00', 'TEST venue', p0 + 3, v_agent, 'closed'),
        (c_soon, 'CPS', 'TEST future', v_today + 3, '15:00', 'TEST venue', p0 + 4, v_agent, 'closed'),
        (c_move, 'CPS', 'TEST move', v_today - 20, '15:00', 'TEST venue', p0 + 5, v_agent, 'closed'),
        (c_min, 'CPS', 'TEST minutes', v_today - 40, '15:00', 'TEST venue', p0 + 6, v_agent, 'closed'),
        (c_close, 'CPS', 'TEST closing', v_today - 40, '15:00', 'TEST venue', p0 + 7, v_agent, 'closed'),
        (c_form, 'CPS', 'TEST form', v_today - 40, '15:00', 'TEST venue', p0 + 8, v_agent, 'closed'),
        (c_cust, 'CPS', 'TEST customer', v_today - 40, '15:00', 'TEST venue', p0 + 9, v_agent, 'closed'),
        (c_d13m, 'CPS', 'TEST day 13 move', v_today - 13, '15:00', 'TEST venue', p0 + 10, v_agent, 'closed'),
        (c_fix, 'CPS', 'TEST wrong date', v_today - 30, '15:00', 'TEST venue', p0 + 11, v_agent, 'closed'),
        (c_ftf, 'FTF', 'TEST old FTF', v_today - 40, '15:00', 'TEST venue', p0 + 12, v_agent, 'closed'),
        (c_stale, 'CPS', 'TEST cron', v_today - 40, '15:00', 'TEST venue', p0 + 13, v_agent, 'closed');
    update public.activities set note_key_points = 'talked' where id = c_min;
    update public.activities set is_closing = true where id = c_close;

    -- ── the agent ──
    perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_ua::text, true);
    execute 'set local role authenticated';

    -- the last day still works, and a future CPS
    v_r := public.cps_cancel(c_d13, 'emergency', null);
    if (v_r ->> 'ok')::boolean then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'day 13 refused'::text; end if;
    v_r := public.cps_cancel(c_soon, 'clash', null);
    if (v_r ->> 'ok')::boolean then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'future refused'::text; end if;

    -- day 14 and older are refused, and say which day it ended
    foreach v_id in array array[c_d14, c_d40] loop
        begin
            perform public.cps_cancel(v_id, 'emergency', null);
            v_fail := v_fail + 1; v_msgs := v_msgs || ('cancelled past the period ' || v_id);
        exception when invalid_parameter_value then
            get stacked diagnostics v_s = message_text;
            v_d := case v_id when c_d14 then v_today - 1 else v_today - 27 end;
            if v_s = 'Cancel period ended on ' || to_char(v_d, 'FMDD Mon') || ', so this CPS cannot be cancelled' then v_pass := v_pass + 1;
            else v_fail := v_fail + 1; v_msgs := v_msgs || ('period message ' || v_s); end if;
        end;
    end loop;

    -- the older refusals still say what they said
    foreach v_id in array array[c_min, c_form, c_cust] loop
        begin
            perform public.cps_cancel(v_id, 'other', null);
            v_fail := v_fail + 1; v_msgs := v_msgs || ('cancelled a real CPS ' || v_id);
        exception when invalid_parameter_value then
            get stacked diagnostics v_s = message_text;
            v_t := case v_id when c_min then 'minutes or a closing' when c_form then 'CPS form on file' else 'already a customer' end;
            if v_s like '%' || v_t || '%' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('message ' || v_s); end if;
        end;
    end loop;

    -- a locked CPS can't be moved or retyped
    begin
        update public.activities set activity_date = v_today + 7 where id = c_move;
        v_fail := v_fail + 1; v_msgs := v_msgs || 'agent moved a locked CPS'::text;
    exception when invalid_parameter_value then
        get stacked diagnostics v_s = message_text;
        if v_s like 'This CPS is past its cancel period%' then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('date message ' || v_s); end if;
    end;
    begin
        update public.activities set activity_type = 'FTF' where id = c_move;
        v_fail := v_fail + 1; v_msgs := v_msgs || 'agent retyped a locked CPS'::text;
    exception when invalid_parameter_value then v_pass := v_pass + 1; end;

    -- anything else on a locked CPS still saves, the same date included
    update public.activities set start_time = '16:00', venue = 'TEST venue 2', activity_date = v_today - 20 where id = c_move;
    get diagnostics v_n = row_count;
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'timing edit blocked'::text; end if;

    -- inside the period Edit is normal
    update public.activities set activity_date = v_today + 5 where id = c_d13m;
    get diagnostics v_n = row_count;
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'day 13 date move blocked'::text; end if;

    -- a CPS that can't be cancelled anyway stays editable, and other activities
    foreach v_id in array array[c_min, c_close, c_form, c_cust, c_ftf] loop
        update public.activities set activity_date = v_today - 39 where id = v_id;
        get diagnostics v_n = row_count;
        if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('real CPS date blocked ' || v_id); end if;
    end loop;
    execute 'reset role';

    select count(*) into v_n from public.activities where id in (c_d14, c_d40);
    if v_n = 2 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'locked CPS removed'::text; end if;
    select count(*) into v_n from public.activities where id in (c_d13, c_soon);
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'open CPS still there'::text; end if;
    select count(*) into v_n from public.cps_cancellations where activity_id in (c_d14, c_d40);
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'history row for a refusal'::text; end if;
    select count(*) into v_n from public.prospects where id in (p0 + 2, p0 + 3) and cps_cancelled_on is not null;
    if v_n = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'marker set by a refusal'::text; end if;
    select count(*) into v_n from public.activities where id = c_move and activity_date = v_today - 20 and activity_type = 'CPS' and start_time::text like '16:00%';
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'locked CPS changed'::text; end if;

    -- ── the leader: same lock ──
    perform set_config('request.jwt.claims', json_build_object('sub', v_ul, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_ul::text, true);
    execute 'set local role authenticated';
    begin
        perform public.cps_cancel(c_d14, 'sick', null);
        v_fail := v_fail + 1; v_msgs := v_msgs || 'leader cancelled past the period'::text;
    exception when invalid_parameter_value then v_pass := v_pass + 1; end;
    begin
        update public.activities set activity_date = v_today + 7 where id = c_move;
        get diagnostics v_n = row_count;
        v_fail := v_fail + 1; v_msgs := v_msgs || ('leader moved a locked CPS, rows ' || v_n);
    exception when invalid_parameter_value then v_pass := v_pass + 1; end;
    execute 'reset role';

    -- ── Super Admin: can't cancel either, can fix the date ──
    perform set_config('request.jwt.claims', json_build_object('sub', v_uad, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_uad::text, true);
    execute 'set local role authenticated';
    begin
        perform public.cps_cancel(c_d14, 'sick', null);
        v_fail := v_fail + 1; v_msgs := v_msgs || 'Super Admin cancelled past the period'::text;
    exception when invalid_parameter_value then v_pass := v_pass + 1; end;
    update public.activities set activity_date = v_today - 19 where id = c_move;
    get diagnostics v_n = row_count;
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'Super Admin date fix'::text; end if;
    execute 'reset role';

    -- ── L2: same, and a fixed date opens the period again ──
    perform set_config('request.jwt.claims', json_build_object('sub', v_um, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_um::text, true);
    execute 'set local role authenticated';
    begin
        perform public.cps_cancel(c_d40, 'sick', null);
        v_fail := v_fail + 1; v_msgs := v_msgs || 'L2 cancelled past the period'::text;
    exception when invalid_parameter_value then v_pass := v_pass + 1; end;
    update public.activities set activity_date = v_today where id = c_fix;
    get diagnostics v_n = row_count;
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'L2 date fix'::text; end if;
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_ua::text, true);
    execute 'set local role authenticated';
    v_r := public.cps_cancel(c_fix, 'other', null);
    if (v_r ->> 'ok')::boolean then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'fixed date stays locked'::text; end if;
    execute 'reset role';

    -- ── no login: cron and the service role aren't agents ──
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    update public.activities set activity_date = v_today - 38 where id = c_stale;
    get diagnostics v_n = row_count;
    if v_n = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'system update blocked'::text; end if;

    raise exception 'CPS_LOCK_RESULT %', jsonb_build_object('pass', v_pass, 'fail', v_fail, 'failures', to_jsonb(v_msgs))::text;
end $$;
