-- Scenario test for migrations/2026-11-12_name_lists_owed.sql — "🤝 Owed to the
-- agent": customers handed a piece from an agent's own stock whose company
-- piece is not back. Stages (collected / at office / overdue / not due), the
-- line narrows (General = every line), returned advances drop out, Do not
-- contact held, the waiting list is unaffected (an owed customer has their
-- piece), rows carry the owed pieces live with the lender, ↩ Returned shows
-- the date. One DO block that ALWAYS raises: rolled back.
-- Result: NAME_LIST_OWED_RESULT {"pass","fail","failures"}
do $$
declare
    v_today date := public.journey_today();
    v_tl bigint := 990000000008001; v_a1 bigint := 990000000008002; v_a2 bigint := 990000000008003;
    u_a1 uuid := '9e000000-0000-4000-8000-000000008002'; u_tl uuid := '9e000000-0000-4000-8000-000000008001';
    -- A1's customers: C1 calligraphy not due · C2 财库 overdue · C3 art at office · C4 calligraphy collected by the agent
    --                 C5 calligraphy returned · C6 calligraphy owed, Do not contact · C7 ring still waiting (no advance)
    c bigint[] := array[990000000008101, 990000000008102, 990000000008103, 990000000008104, 990000000008105, 990000000008106, 990000000008107];
    items text[] := array['Calligraphy Series: 元亨利貞', '财库 Royal Woodwork', 'Artistic Masterpiece: 山水', 'Calligraphy Series: 福',
                          'Calligraphy Series: 寿', 'Calligraphy Series: 禄', 'SUPPORT POWER RING'];
    v_r jsonb; v_list bigint; v_i int; v_row jsonb;
    v_pass int := 0; v_fail int := 0; v_msgs text[] := '{}';
    v_owed jsonb := jsonb_build_object('purpose', 'service', 'line', 'general', 'goal', 'service', 'scope', 'mine', 'who', 'owed');
begin
    insert into public.users (id, full_name, role, role_level, reporting_to, status, auth_user_id) values
        (v_tl, 'TEST NLO Leader (Claude)', 'Level 5 Team Leader', 5, null, 'active', u_tl),
        (v_a1, 'TEST NLO Agent One (Claude)', 'Level 7 Agent', 7, v_tl, 'active', u_a1),
        (v_a2, 'TEST NLO Lender (Claude)', 'Level 7 Agent', 7, v_tl, 'active', null);
    for v_i in 1 .. 7 loop
        insert into public.customers (id, full_name, phone, responsible_agent_id, do_not_invite)
        values (c[v_i], 'TEST NLO C' || v_i || ' (Claude)', '+6099000008' || (100 + v_i), v_a1, v_i = 6);
        insert into public.purchases (id, customer_id, date, item, amount, status, agent_id)
        values (990000000008200 + v_i, c[v_i], v_today - 90, items[v_i], 5000, 'paid', v_a1);
        -- C1–C6 handed over (from the agent's stock); C7 still waiting
        insert into public.delivery_items (id, customer_id, purchase_id, item_name, expected_ready_date, status, handover_date, photos,
                                           office_ready_date, office_ready_place, collected_at)
        values (990000000008300 + v_i, c[v_i], 990000000008200 + v_i, items[v_i], v_today + 30,
                case when v_i = 7 then 'pending' else 'picked_up' end,
                case when v_i = 7 then null else v_today - 60 end,
                case when v_i = 7 then '[]'::jsonb else '["delivery/x/c.jpg"]'::jsonb end,
                case when v_i in (3, 4) then v_today - 3 end, case when v_i in (3, 4) then 'lvl 20' end,
                case when v_i = 4 then v_today - 1 end);
    end loop;
    insert into public.delivery_advances (delivery_item_id, lender_agent_id, sale_agent_id, given_date, expected_back, status, returned_date) values
        (990000000008301, v_a2, v_a1, v_today - 60, v_today + 40, 'owed', null),
        (990000000008302, v_a2, v_a1, v_today - 60, v_today - 5, 'owed', null),
        (990000000008303, v_a2, v_a1, v_today - 60, v_today + 10, 'owed', null),
        (990000000008304, v_a2, v_a1, v_today - 60, v_today + 10, 'owed', null),
        (990000000008305, v_a2, v_a1, v_today - 60, v_today - 30, 'returned', v_today - 2),
        (990000000008306, v_a2, v_a1, v_today - 60, v_today + 40, 'owed', null);

    create function pg_temp.nlo_as(p_uid uuid) returns void language plpgsql as $f$
    begin
        perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
        perform set_config('request.jwt.claim.sub', p_uid::text, true);
        set local role authenticated;
    end $f$;

    -- ── 1. owed: C1 C2 C3 C4 (C5 returned out, C7 has no advance), C6 held ──
    perform pg_temp.nlo_as(u_a1);
    v_r := public.name_list_preview(v_owed);
    reset role;
    if (v_r ->> 'match')::int = 4 and (v_r ->> 'held')::int = 1 then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('owed ' || v_r::text); end if;

    -- ── 2. the line narrows: Calligraphy = C1 C4; Power Ring = nobody ──
    perform pg_temp.nlo_as(u_a1);
    v_r := public.name_list_preview(v_owed || '{"line": "calligraphy"}');
    if (v_r ->> 'match')::int = 2 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('calligraphy ' || v_r::text); end if;
    v_r := public.name_list_preview(v_owed || '{"line": "ring"}');
    reset role;
    if (v_r ->> 'match')::int = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('ring ' || v_r::text); end if;

    -- ── 3. the waiting list is unaffected: only C7 is still waiting to collect ──
    perform pg_temp.nlo_as(u_a1);
    v_r := public.name_list_preview(v_owed || '{"who": "waiting"}');
    reset role;
    if (v_r ->> 'match')::int = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('waiting ' || v_r::text); end if;

    -- ── 4. the list: collected first, then at office, overdue, not due; lender in the reason ──
    perform pg_temp.nlo_as(u_a1);
    v_r := public.name_list_create(v_owed || '{"target_qty": 10, "name": "TEST NLO list"}');
    reset role;
    v_list := (v_r ->> 'id')::bigint;
    if (select count(*) from public.name_list_rows where list_id = v_list and decision = 'selected') = 4
       and (select customer_id from public.name_list_rows where list_id = v_list and rank = 1) = c[4]
       and (select customer_id from public.name_list_rows where list_id = v_list and rank = 2) = c[3]
       and (select customer_id from public.name_list_rows where list_id = v_list and rank = 3) = c[2]
       and (select customer_id from public.name_list_rows where list_id = v_list and rank = 4) = c[1]
       and (select reasons -> 0 ->> 't' from public.name_list_rows where list_id = v_list and customer_id = c[1])
           = 'Lent from TEST NLO Lender (Claude)''s stock: Calligraphy Series: 元亨利貞 — company piece not back yet'
       and (select who = 'owed' and stage is null from public.name_lists where id = v_list)
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'owed list order / reason'::text; end if;

    -- ── 5. rows carry the owed pieces live (lender, stage, office) ──
    perform pg_temp.nlo_as(u_a1);
    v_r := public.name_list_get(v_list, null);
    reset role;
    select x into v_row from jsonb_array_elements(v_r -> 'rows') x where (x ->> 'customer_id')::bigint = c[3];
    if v_row -> 'pieces' -> 0 ->> 'kind' = 'owed' and v_row -> 'pieces' -> 0 ->> 'stage' = 'at_office'
       and (v_row -> 'pieces' -> 0 ->> 'adv_id')::bigint = (select id from public.delivery_advances where delivery_item_id = 990000000008303)
       and v_row -> 'pieces' -> 0 ->> 'lender' = 'TEST NLO Lender (Claude)' and v_row -> 'pieces' -> 0 ->> 'place' = 'lvl 20'
       and exists (select 1 from jsonb_array_elements(v_r -> 'rows') x where (x ->> 'customer_id')::bigint = c[4] and x -> 'pieces' -> 0 ->> 'stage' = 'collected')
       and exists (select 1 from jsonb_array_elements(v_r -> 'rows') x where (x ->> 'customer_id')::bigint = c[2] and x -> 'pieces' -> 0 ->> 'stage' = 'due')
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('owed pieces ' || coalesce(v_row::text, 'none')); end if;

    -- ── 6. ↩ Returned → nothing owed, the return date shows ──
    update public.delivery_advances set status = 'returned', returned_date = v_today where delivery_item_id = 990000000008304;
    perform pg_temp.nlo_as(u_a1);
    v_r := public.name_list_get(v_list, null);
    reset role;
    select x into v_row from jsonb_array_elements(v_r -> 'rows') x where (x ->> 'customer_id')::bigint = c[4];
    if jsonb_array_length(v_row -> 'pieces') = 0 and (v_row ->> 'handed_at')::date = v_today then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('returned ' || coalesce(v_row::text, 'none')); end if;

    raise exception 'NAME_LIST_OWED_RESULT %', json_build_object('pass', v_pass, 'fail', v_fail, 'failures', v_msgs);
end $$;
