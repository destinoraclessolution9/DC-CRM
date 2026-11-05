-- Scenario test for migrations/2026-11-05_name_lists_who.sql — "Who to include"
-- by what people bought: exactly 1 (a "X + Y POWER RING" sale counts 2, two
-- sales count 2, cancelled / refunded sales count 0), 1 or more (owning 2 no
-- longer holds anyone back), never bought, the bought-between window, Do not
-- contact still held, the preview count = the list made, a team list spans its
-- agents, the owned item leads the reasons, the offer is saved + editable, bad
-- input refused — and ✨ Who to invite's engine is unchanged (no 50 cut-off
-- only when a list asks). One DO block that ALWAYS raises: all rolled back.
-- Result: NAME_LIST_WHO_RESULT {"pass","fail","failures"}
do $$
declare
    v_today date := public.journey_today();
    v_tl bigint := 990000000005001; v_a1 bigint := 990000000005002; v_a2 bigint := 990000000005003;
    u_tl uuid := '9b000000-0000-4000-8000-000000005001'; u_a1 uuid := '9b000000-0000-4000-8000-000000005002';
    u_a2 uuid := '9b000000-0000-4000-8000-000000005003';
    -- A1: C1 one ring · C2 "X + Y" sale · C3 two sales · C4 one ring, Do not contact · C5 cancelled sale
    --     C6 never bought · C7 one ring in 2024 · C9 refunded sale.   A2: C8 one ring
    c bigint[] := array[990000000005101, 990000000005102, 990000000005103, 990000000005104, 990000000005105,
                        990000000005106, 990000000005107, 990000000005108, 990000000005109];
    v_r jsonb; v_list bigint; v_s text; v_i int; v_n int;
    v_pass int := 0; v_fail int := 0; v_msgs text[] := '{}';
    v_ring jsonb := jsonb_build_object('purpose', 'promote', 'line', 'ring', 'goal', 'upgrade', 'scope', 'mine');
begin
    insert into public.users (id, full_name, role, role_level, reporting_to, status, auth_user_id) values
        (v_tl, 'TEST NLW Leader (Claude)', 'Level 5 Team Leader', 5, null, 'active', u_tl),
        (v_a1, 'TEST NLW Agent One (Claude)', 'Level 7 Agent', 7, v_tl, 'active', u_a1),
        (v_a2, 'TEST NLW Agent Two (Claude)', 'Level 7 Agent', 7, v_tl, 'active', u_a2);
    for v_i in 1 .. 9 loop
        insert into public.customers (id, full_name, phone, responsible_agent_id, do_not_invite)
        values (c[v_i], 'TEST NLW C' || v_i || ' (Claude)', '+6099000005' || (100 + v_i),
                case when v_i = 8 then v_a2 else v_a1 end, v_i = 4);
    end loop;
    insert into public.purchases (id, customer_id, date, item, amount, status) values
        (990000000005201, c[1], v_today - 10, 'SUPPORT POWER RING', 3800, 'paid'),
        (990000000005202, c[2], v_today - 40, 'SUPPORT POWER RING + WISDOM POWER RING', 7600, 'paid'),
        (990000000005203, c[3], v_today - 300, '六曜指环 Support Power Ring', 3800, 'paid'),
        (990000000005204, c[3], v_today - 20, '八大护法 Prosperity Power Ring', 3800, 'paid'),
        (990000000005205, c[4], v_today - 15, 'WISDOM POWER RING', 3800, 'paid'),
        (990000000005206, c[5], v_today - 12, 'AUTHORITY POWER RING', 3800, 'Cancelled'),
        (990000000005207, c[7], date '2024-01-15', 'Power Ring 4, size 17.5', 3800, 'paid'),
        (990000000005208, c[8], v_today - 8, 'PROSPERITY POWER RING / RINGSIZE 10.5', 3800, 'paid'),
        (990000000005209, c[9], v_today - 9, 'SUPPORT POWER RING', 3800, 'paid');
    insert into public.sale_cancellations (id, purchase_id, status, requested_at, reason, bank_name, bank_account, account_holder, request_file,
                                           signed_at, acceptance_file, refund_total, refund_months, first_refund_month, refunded_at)
    values (990000000005301, 990000000005209, 'completed', v_today - 5, 'TEST', 'TEST', '0', 'TEST', 'TEST',
            v_today - 4, 'TEST', 3800, 1, v_today, v_today);

    create function pg_temp.nlw_as(p_uid uuid) returns void language plpgsql as $f$
    begin
        perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
        perform set_config('request.jwt.claim.sub', p_uid::text, true);
        set local role authenticated;
    end $f$;

    -- ── 1. bought exactly 1: C1 + C7 (C2 / C3 own 2, C5 / C9 sales don't count), C4 held ──
    perform pg_temp.nlw_as(u_a1);
    v_r := public.name_list_preview(v_ring || '{"who": "owns_1"}');
    reset role;
    if (v_r ->> 'match')::int = 2 and (v_r ->> 'held')::int = 1 then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('owns_1 preview ' || v_r::text); end if;

    -- ── 2. bought between: only C1's ring is in the last 30 days ──
    perform pg_temp.nlw_as(u_a1);
    v_r := public.name_list_preview(v_ring || jsonb_build_object('who', 'owns_1', 'bought_from', v_today - 30, 'bought_to', v_today));
    reset role;
    if (v_r ->> 'match')::int = 1 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('window ' || v_r::text); end if;

    -- ── 3. 1 or more: C1 C2 C3 C7 (owning 2 no longer holds C2 / C3 back) ──
    perform pg_temp.nlw_as(u_a1);
    v_r := public.name_list_preview(v_ring || '{"who": "owns_any"}');
    reset role;
    if (v_r ->> 'match')::int = 4 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('owns_any ' || v_r::text); end if;

    -- ── 4. never bought: C5 (cancelled) C6 C9 (refunded) ──
    perform pg_temp.nlw_as(u_a1);
    v_r := public.name_list_preview(v_ring || '{"who": "owns_none", "goal": "decide"}');
    reset role;
    if (v_r ->> 'match')::int = 3 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('owns_none ' || v_r::text); end if;

    -- ── 5. the list made = the preview; owned item leads; offer + rules saved ──
    perform pg_temp.nlw_as(u_a1);
    v_r := public.name_list_create(v_ring || '{"who": "owns_1", "target_qty": 5, "name": "TEST NLW ring", "offer": "2nd ring RM1,000 off"}');
    v_list := (v_r ->> 'id')::bigint;
    reset role;
    select count(*) into v_n from public.name_list_rows where list_id = v_list and decision = 'selected';
    if v_n = 2
       and exists (select 1 from public.name_list_rows where list_id = v_list and customer_id = c[1] and reasons -> 0 ->> 't' = 'Bought SUPPORT POWER RING')
       and exists (select 1 from public.name_list_rows where list_id = v_list and customer_id = c[7])
       and not exists (select 1 from public.name_list_rows where list_id = v_list and customer_id in (c[2], c[3], c[4], c[5], c[9]))
       and (select who = 'owns_1' and offer = '2nd ring RM1,000 off' from public.name_lists where id = v_list)
       and (select rules ->> 'who' = 'owns_1' and rules ? 'own_count' from public.name_list_versions where list_id = v_list)
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('owns_1 list rows ' || v_n); end if;

    -- ── 6. the page gets who / offer / next-step rule ──
    perform pg_temp.nlw_as(u_a1);
    v_r := public.name_list_get(v_list, null);
    reset role;
    if v_r #>> '{list,who}' = 'owns_1' and v_r #>> '{list,offer}' = '2nd ring RM1,000 off'
       and (v_r -> 'rows' -> 0) ? 'next_step_rule'
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'get misses who/offer'::text; end if;

    -- ── 7. offer is editable ──
    perform pg_temp.nlw_as(u_a1);
    perform public.name_list_set(v_list, '{"offer": "2nd ring RM800 off"}');
    reset role;
    if (select offer from public.name_lists where id = v_list) = '2nd ring RM800 off' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || 'offer not edited'::text; end if;

    -- ── 8. a leader's team list spans both agents (C1 C7 + A2's C8) ──
    perform pg_temp.nlw_as(u_tl);
    v_r := public.name_list_preview(v_ring || '{"who": "owns_1", "scope": "team"}');
    reset role;
    if (v_r ->> 'match')::int = 3 and (v_r ->> 'agents')::int = 2 and (v_r ->> 'per_agent_max')::int = 2 then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_msgs := v_msgs || ('team preview ' || v_r::text); end if;

    -- ── 9. bad input refused ──
    perform pg_temp.nlw_as(u_a1);
    begin perform public.name_list_preview('{"line": "general", "goal": "decide", "who": "owns_1"}');
          v_fail := v_fail + 1; v_msgs := v_msgs || 'general + owns accepted'::text;
    exception when others then v_pass := v_pass + 1; end;
    begin perform public.name_list_preview(v_ring || jsonb_build_object('who', 'owns_1', 'bought_from', v_today, 'bought_to', v_today - 5));
          v_fail := v_fail + 1; v_msgs := v_msgs || 'from > to accepted'::text;
    exception when others then v_pass := v_pass + 1; end;
    begin perform public.name_list_preview(v_ring || '{"who": "everyone"}');
          v_fail := v_fail + 1; v_msgs := v_msgs || 'unknown who accepted'::text;
    exception when others then v_pass := v_pass + 1; end;
    reset role;

    -- ── 10. best fit still cuts at 50: a quiet one-ring owner (fit 35) is not suggested ──
    perform pg_temp.nlw_as(u_a1);
    v_r := public.name_list_preview(v_ring || '{"who": "best"}');
    reset role;
    if (v_r ->> 'match')::int = 0 then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || ('best preview ' || v_r::text); end if;

    -- ── 11. ✨ Who to invite's engine without the setting: unchanged ──
    perform set_config('request.jwt.claims', json_build_object('sub', u_a1, 'role', 'authenticated')::text, true);
    if not exists (select 1 from public.inv_compute('[{"line": "ring", "goal": "upgrade"}]'::jsonb, null, null) x
                    where x.person_key = 'c:' || c[1] and x.excl is null)
       and coalesce(current_setting('inv.min_fit', true), '') = ''
    then v_pass := v_pass + 1; else v_fail := v_fail + 1; v_msgs := v_msgs || 'engine cut-off leaked'::text; end if;

    raise exception 'NAME_LIST_WHO_RESULT %', json_build_object('pass', v_pass, 'fail', v_fail, 'failures', v_msgs);
end $$;
