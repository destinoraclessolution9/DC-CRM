-- Scenario test for migrations/2026-11-12_name_lists_waiting.sql — "📦 Waiting
-- to collect": pending pieces by stage (told / at office / ready date passed /
-- still being made), Ready now vs Still being made, the line narrows (General
-- = every piece), cancelled orders / closed legacy pieces / pre-system stand-ins
-- out, Do not contact held, "Pr 6" counts as a ring, ready-now first, a long
-- overdue piece flagged, rows carry their pieces live and show the handover,
-- a leader's team list spans agents, bad stage refused. Always rolled back.
-- Result: NAME_LIST_WAITING_RESULT {"pass","fail","failures"}
do $$
declare
    v_today date := public.journey_today();
    v_tl bigint := 990000000007001; v_a1 bigint := 990000000007002; v_a2 bigint := 990000000007003;
    u_tl uuid := '9d000000-0000-4000-8000-000000007001'; u_a1 uuid := '9d000000-0000-4000-8000-000000007002';
    u_a2 uuid := '9d000000-0000-4000-8000-000000007003';
    -- A1: C1 due · C2 making · C3 at office · C4 told · C5 calligraphy due · C6 handed over · C7 cancelled order
    --     C8 pre-system stand-in · C10 due since Jan 2025 (stale) · C11 Do not contact · C12 closed legacy.  A2: C9 "Pr 6" due
    c bigint[] := array[990000000007101, 990000000007102, 990000000007103, 990000000007104, 990000000007105, 990000000007106,
                        990000000007107, 990000000007108, 990000000007109, 990000000007110, 990000000007111, 990000000007112];
    v_r jsonb; v_list bigint; v_i int; v_row jsonb;
    v_pass int := 0; v_fail int := 0; v_msgs text[] := '{}';
    v_ring jsonb := jsonb_build_object('purpose', 'service', 'line', 'ring', 'goal', 'service', 'scope', 'mine', 'who', 'waiting');
begin
    insert into public.users (id, full_name, role, role_level, reporting_to, status, auth_user_id) values
        (v_tl, 'TEST NLWT Leader (Claude)', 'Level 5 Team Leader', 5, null, 'active', u_tl),
        (v_a1, 'TEST NLWT Agent One (Claude)', 'Level 7 Agent', 7, v_tl, 'active', u_a1),
        (v_a2, 'TEST NLWT Agent Two (Claude)', 'Level 7 Agent', 7, v_tl, 'active', u_a2);
    for v_i in 1 .. 12 loop
        insert into public.customers (id, full_name, phone, responsible_agent_id, do_not_invite)
        values (c[v_i], 'TEST NLWT C' || v_i || ' (Claude)', '+6099000007' || (100 + v_i), case when v_i = 9 then v_a2 else v_a1 end, v_i = 11);
        insert into public.purchases (id, customer_id, date, item, amount, status)
        values (990000000007200 + v_i, c[v_i], v_today - 100,
                case v_i when 5 then 'Calligraphy Series: 元亨利貞' when 8 then 'Imported / pre-system balance' when 9 then 'Pr 6'
                         else 'SUPPORT POWER RING' end, 3800, case when v_i = 7 then 'Cancelled' else 'paid' end);
    end loop;
    insert into public.delivery_items (id, customer_id, purchase_id, item_name, expected_ready_date, status, office_ready_date, office_ready_place,
                                       customer_told_at, handover_date, photos, legacy_closed) values
        (990000000007301, c[1],  990000000007201, 'SUPPORT POWER RING', v_today - 10, 'pending', null, null, null, null, '[]', false),
        (990000000007302, c[2],  990000000007202, 'SUPPORT POWER RING', v_today + 60, 'pending', null, null, null, null, '[]', false),
        (990000000007303, c[3],  990000000007203, 'SUPPORT POWER RING', v_today - 5, 'pending', v_today - 2, 'lvl 20', null, null, '[]', false),
        (990000000007304, c[4],  990000000007204, 'SUPPORT POWER RING', v_today - 30, 'pending', v_today - 20, 'lvl 20', now() - interval '3 days', null, '[]', false),
        (990000000007305, c[5],  990000000007205, 'Calligraphy Series: 元亨利貞', v_today - 3, 'pending', null, null, null, null, '[]', false),
        (990000000007306, c[6],  990000000007206, 'SUPPORT POWER RING', v_today - 40, 'picked_up', null, null, null, v_today - 1, '["delivery/x/a.jpg"]', false),
        (990000000007307, c[7],  990000000007207, 'SUPPORT POWER RING', v_today - 10, 'pending', null, null, null, null, '[]', false),
        (990000000007308, c[8],  990000000007208, 'Imported / pre-system balance', null, 'pending', null, null, null, null, '[]', false),
        (990000000007309, c[9],  990000000007209, 'Pr 6', v_today - 7, 'pending', null, null, null, null, '[]', false),
        (990000000007310, c[10], 990000000007210, 'SUPPORT POWER RING', date '2025-01-15', 'pending', null, null, null, null, '[]', false),
        (990000000007311, c[11], 990000000007211, 'SUPPORT POWER RING', v_today - 10, 'pending', null, null, null, null, '[]', false),
        (990000000007312, c[12], 990000000007212, 'SUPPORT POWER RING', v_today - 10, 'pending', null, null, null, null, '[]', true);

    create function pg_temp.nlwt_as(p_uid uuid) returns void language plpgsql as $f$
    begin
        perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
        perform set_config('request.jwt.claim.sub', p_uid::text, true);
        set local role authenticated;
    end $f$;

    -- ── 1. any stage: C1 C2 C3 C4 C10 (C6 handed over, C7 cancelled, C8 stand-in, C12 legacy out), C11 held ──
    perform pg_temp.nlwt_as(u_a1);
    v_r := public.name_list_preview(v_ring);
    reset role;
    if (v_r ->> 'match')::int = 5 and (v_r ->> 'held')::int = 1 then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('any ' || v_r::text); end if;

    -- ── 2. ready now: told / at office / ready date passed (C1 C3 C4 C10) · still being made: C2 ──
    perform pg_temp.nlwt_as(u_a1);
    v_r := public.name_list_preview(v_ring || '{"stage": "ready"}');
    if (v_r ->> 'match')::int = 4 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('ready ' || v_r::text); end if;
    v_r := public.name_list_preview(v_ring || '{"stage": "making"}');
    reset role;
    if (v_r ->> 'match')::int = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('making ' || v_r::text); end if;

    -- ── 3. General = every piece (+ C5's calligraphy) ──
    perform pg_temp.nlwt_as(u_a1);
    v_r := public.name_list_preview(v_ring || '{"line": "general"}');
    reset role;
    if (v_r ->> 'match')::int = 6 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('general ' || v_r::text); end if;

    -- ── 4. the list: ready-now first (told, at office, oldest due), still being made last; stale flagged ──
    perform pg_temp.nlwt_as(u_a1);
    v_r := public.name_list_create(v_ring || '{"target_qty": 10, "name": "TEST NLWT list", "offer": "Collect it at the 20 Nov event"}');
    reset role;
    v_list := (v_r ->> 'id')::bigint;
    if (select count(*) from public.name_list_rows where list_id = v_list and decision = 'selected') = 5
       and (select customer_id from public.name_list_rows where list_id = v_list and rank = 1) = c[4]
       and (select customer_id from public.name_list_rows where list_id = v_list and rank = 2) = c[3]
       and (select customer_id from public.name_list_rows where list_id = v_list and rank = 3) = c[10]
       and (select customer_id from public.name_list_rows where list_id = v_list and rank = 5) = c[2]
       and (select reasons -> 0 ->> 't' like 'Ordered SUPPORT POWER RING%not collected yet' from public.name_list_rows where list_id = v_list and customer_id = c[1])
       and (select warnings ? 'check_record' from public.name_list_rows where list_id = v_list and customer_id = c[10])
       and (select stage = 'any' and who = 'waiting' from public.name_lists where id = v_list)
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'list order / reasons / flag'::text; end if;

    -- ── 5. rows carry their pieces live (stage, office place) ──
    perform pg_temp.nlwt_as(u_a1);
    v_r := public.name_list_get(v_list, null);
    reset role;
    select x into v_row from jsonb_array_elements(v_r -> 'rows') x where (x ->> 'customer_id')::bigint = c[3];
    if v_r #>> '{list,stage}' = 'any' and v_row -> 'pieces' -> 0 ->> 'stage' = 'at_office' and v_row -> 'pieces' -> 0 ->> 'place' = 'lvl 20'
       and (v_row -> 'pieces' -> 0 ->> 'purchase_id')::bigint = 990000000007203
       and exists (select 1 from jsonb_array_elements(v_r -> 'rows') x where (x ->> 'customer_id')::bigint = c[4] and x -> 'pieces' -> 0 ->> 'stage' = 'told')
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('pieces ' || coalesce(v_row::text, 'none')); end if;

    -- ── 6. handed over → no pieces left, the handover date shows ──
    update public.delivery_items set status = 'picked_up', handover_date = v_today, photos = '["delivery/x/b.jpg"]' where id = 990000000007301;
    perform pg_temp.nlwt_as(u_a1);
    v_r := public.name_list_get(v_list, null);
    reset role;
    select x into v_row from jsonb_array_elements(v_r -> 'rows') x where (x ->> 'customer_id')::bigint = c[1];
    if jsonb_array_length(v_row -> 'pieces') = 0 and (v_row ->> 'handed_at')::date = v_today then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('handed ' || coalesce(v_row::text, 'none')); end if;

    -- ── 7. a leader's team list: A1's 4 still waiting + A2's "Pr 6" ──
    perform pg_temp.nlwt_as(u_tl);
    v_r := public.name_list_preview(v_ring || '{"scope": "team"}');
    reset role;
    if (v_r ->> 'match')::int = 5 and (v_r ->> 'agents')::int = 2 then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('team ' || v_r::text); end if;

    -- ── 8. "Pr 6" also counts as a ring for the bought filters ──
    if exists (select 1 from public.nl_line_sales('ring') s where s.person_key = 'c:' || c[9] and s.items = 1) then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'Pr 6 not a ring sale'::text; end if;

    -- ── 9. bad stage refused; stage only kept on waiting lists ──
    perform pg_temp.nlwt_as(u_a1);
    begin perform public.name_list_preview(v_ring || '{"stage": "soon"}'); v_fail := v_fail + 1; v_msgs := v_msgs || 'bad stage accepted'::text;
    exception when others then v_pass := v_pass + 1; end;
    v_r := public.name_list_create('{"purpose": "promote", "line": "ring", "goal": "upgrade", "who": "owns_1", "stage": "ready", "target_qty": 5, "name": "TEST NLWT owns"}');
    reset role;
    if (select stage is null from public.name_lists where id = (v_r ->> 'id')::bigint) then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'stage kept on owns list'::text; end if;

    raise exception 'NAME_LIST_WAITING_RESULT %', json_build_object('pass', v_pass, 'fail', v_fail, 'failures', v_msgs);
end $$;
