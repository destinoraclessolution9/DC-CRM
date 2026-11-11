-- ci/sql/office-notice-scenario.sql — scenario for
-- migrations/2026-11-11_office_ready_notices.sql. Run via the Management API
-- AFTER the migration: one DO block ending in RAISE EXCEPTION, so every TEST
-- row rolls back and the result comes back in the error message.
-- Expect:
--  1 office_sn_norm: PR/PRN dropped, SG kept
--  2 candidates (as a staff member): every line, SN → order, its items + advance
--  3 a wrong order for a line is refused
--  4 apply: existing item marked ready (date = collect date, place, notice),
--    a never-opened order gets a new item, the lender's piece is marked too,
--    item status untouched, lines + notice marked applied
--  5 pushes: sale agent (2 items) + lender (1 line, "your piece back")
--  6 a second apply of the same lines does nothing; a later line pushes again
--  7 not staff → refused
do $$
declare j jsonb := '{}'; seller bigint := 1775637005921; lender bigint := 1775472202840;
 staff_sub text := '29df4985-fe38-4435-9a58-b0b9bffb13cc';
 C1 bigint := 990000000000701; C2 bigint := 990000000000702;
 P1 bigint := 990000000000711; P2 bigint := 990000000000712; P3 bigint := 990000000000713;
 d date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
 nid bigint; i1 bigint; i3 bigint; l1 bigint; l2 bigint; l3 bigint; l4 bigint; l5 bigint; v jsonb; n int;
begin
 j := j || jsonb_build_object('1_norm', (select json_agg(office_sn_norm(x)) from unnest(array['PR 9990711', 'PRN19018491', 'SG 0000013', ' 1908 016', '', null]) x));

 insert into customers (id, full_name, phone, responsible_agent_id, created_at, updated_at) values
   (C1, 'TEST Office Tan', '0123456789', seller, now(), now()), (C2, 'TEST Office Lim', null, seller, now(), now());
 insert into purchases (id, customer_id, date, item, amount, status, payment_method, agent_id, invoice, created_at, updated_at) values
   (P1, C1, d - 200, 'TEST 财库，财托', 8000, 'COMPLETED', 'Cash', seller, 'PR 9990711', now(), now()),
   (P2, C1, d - 150, 'TEST 上龙柄', 6000, 'COMPLETED', 'Cash', seller, '9990712', now(), now()),
   (P3, C2, d - 100, 'TEST 财库', 8000, 'COMPLETED', 'Cash', seller, '9990713', now(), now());
 insert into delivery_items (customer_id, purchase_id, item_name, status, expected_ready_date) values (C1, P1, '财库，财托', 'pending', d + 30) returning id into i1;
 -- P3: already handed over from the lender's own stock (owed back)
 insert into delivery_items (customer_id, purchase_id, item_name, status) values (C2, P3, '财库', 'pending') returning id into i3;
 update delivery_items set status = 'picked_up', handover_date = d - 5, photos = '["delivery/test/x.jpg"]'::jsonb where id = i3;
 insert into delivery_advances (delivery_item_id, lender_agent_id, given_date) values (i3, lender, d - 5);

 insert into office_notices (photo_path, status, title, collect_date, place) values ('office-notices/test/x.jpg', 'read', 'TEST 財庫 pls collect', d + 1, 'lvl 20') returning id into nid;
 insert into office_notice_lines (notice_id, line_no, sn_raw, customer, item) values (nid, 1, '9990711', 'TEST OFFICE TAN', '財庫') returning id into l1;
 insert into office_notice_lines (notice_id, line_no, sn_raw, customer, item) values (nid, 2, 'PR9990712', 'TEST OFFICE TAN', '上龍柄') returning id into l2;
 insert into office_notice_lines (notice_id, line_no, sn_raw, customer, item) values (nid, 3, '9990713', 'TEST OFFICE LIM', '財庫') returning id into l3;
 insert into office_notice_lines (notice_id, line_no, sn_raw, customer, item) values (nid, 4, '19999999', 'SOMEONE ELSE', '財庫') returning id into l4;
 insert into office_notice_lines (notice_id, line_no, sn_raw, customer, item) values (nid, 5, 'PR 9990711', 'TEST OFFICE TAN', '財托') returning id into l5;

 -- 2: candidates as a staff member
 perform set_config('request.jwt.claims', json_build_object('sub', staff_sub, 'role', 'authenticated')::text, true);
 set local role authenticated;
 v := office_notice_candidates(nid);
 reset role;
 j := j || jsonb_build_object('2_lines', jsonb_array_length(v),
   '2_norms', (select json_agg(x->>'sn_norm' order by (x->>'line_no')::int) from jsonb_array_elements(v) x),
   '2_orders_per_line', (select json_agg(jsonb_array_length(x->'orders') order by (x->>'line_no')::int) from jsonb_array_elements(v) x),
   '2_line1', (select jsonb_build_object('kind', o->>'kind', 'order_ok', (o->>'id')::bigint = P1, 'name', o->>'customer_name', 'agent', o->>'agent_name',
                 'items', (select json_agg(it->>'item_name') from jsonb_array_elements(o->'items') it)) from jsonb_array_elements(v) x, jsonb_array_elements(x->'orders') o where (x->>'line_no')::int = 1),
   '2_line2_items', (select jsonb_array_length(o->'items') from jsonb_array_elements(v) x, jsonb_array_elements(x->'orders') o where (x->>'line_no')::int = 2),
   '2_line3_adv', (select jsonb_build_object('status', it->>'status', 'adv', it->>'adv_status', 'lender_ok', (it->>'adv_lender_id')::bigint = lender)
                 from jsonb_array_elements(v) x, jsonb_array_elements(x->'orders') o, jsonb_array_elements(o->'items') it where (x->>'line_no')::int = 3));

 -- 3: a line pointed at an order that does not carry its SN
 begin
   perform office_notice_apply(nid, jsonb_build_array(jsonb_build_object('line_id', l1, 'kind', 'purchase', 'order_id', P2, 'item_id', null)));
   j := j || jsonb_build_object('3_wrong_order', 'ALLOWED (bad)');
 exception when others then j := j || jsonb_build_object('3_wrong_order', 'refused: ' || sqlerrm); end;

 -- 4: apply lines 1-3 as the staff member
 set local role authenticated;
 v := office_notice_apply(nid, jsonb_build_array(
   jsonb_build_object('line_id', l1, 'kind', 'purchase', 'order_id', P1, 'item_id', i1),
   jsonb_build_object('line_id', l2, 'kind', 'purchase', 'order_id', P2, 'item_id', null, 'item_name', 'TEST 上龙柄'),
   jsonb_build_object('line_id', l3, 'kind', 'purchase', 'order_id', P3, 'item_id', i3)));
 reset role;
 j := j || jsonb_build_object('4_result', v,
   '4_items', (select json_agg(json_build_object('p', case purchase_id when P1 then 'P1' when P2 then 'P2' else 'P3' end, 'name', item_name, 'status', status,
                 'ready', office_ready_date = d + 1, 'place', office_ready_place, 'notice_ok', office_notice_id = nid) order by purchase_id)
               from delivery_items where purchase_id in (P1, P2, P3)),
   '4_lines', (select json_agg(json_build_object('n', line_no, 'applied', applied_at is not null, 'decision', decision, 'item_set', delivery_item_id is not null) order by line_no) from office_notice_lines where notice_id = nid),
   '4_notice', (select status from office_notices where id = nid));

 -- 5: pushes
 j := j || jsonb_build_object('5_push', (select json_agg(json_build_object('to', case user_id when seller then 'seller' when lender then 'lender' end, 'title', title, 'body', body, 'url', url) order by user_id)
               from notification_outbox where kind = 'office_ready' and dedupe_key like 'office_ready:' || nid || ':%'));

 -- 6: re-apply does nothing; a later line pushes again
 v := office_notice_apply(nid, jsonb_build_array(jsonb_build_object('line_id', l1, 'kind', 'purchase', 'order_id', P1, 'item_id', i1)));
 j := j || jsonb_build_object('6_reapply', v);
 v := office_notice_apply(nid, jsonb_build_array(jsonb_build_object('line_id', l5, 'kind', 'purchase', 'order_id', P1, 'item_id', null)));
 j := j || jsonb_build_object('6_later_line', v, '6_pushes_now', (select count(*) from notification_outbox where kind = 'office_ready' and dedupe_key like 'office_ready:' || nid || ':%'),
   '6_new_item_name', (select item_name from delivery_items where id = (select delivery_item_id from office_notice_lines where id = l5)));

 -- 7: not staff (no CRM user behind the token)
 perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-000000000000', 'role', 'authenticated')::text, true);
 set local role authenticated;
 begin
   perform office_notice_candidates(nid);
   j := j || jsonb_build_object('7_not_staff', 'ALLOWED (bad)');
 exception when others then j := j || jsonb_build_object('7_not_staff', 'refused: ' || sqlerrm); end;
 j := j || jsonb_build_object('7_not_staff_rows', (select count(*) from office_notices where id = nid));
 reset role;

 raise exception 'SCENARIO %', j;
end $$;
