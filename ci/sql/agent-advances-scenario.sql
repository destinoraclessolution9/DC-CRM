-- ci/sql/agent-advances-scenario.sql — scenario for
-- migrations/2026-10-21_delivery_agent_advances.sql. Run via the Management
-- API AFTER the migration: one DO block ending in RAISE EXCEPTION, so every
-- TEST row rolls back and the result comes back in the error message.
-- Expect: 1 eligibility (calligraphy/artistic/财库 yes; ring/专案/灵活 no) ·
-- 2 lend before handover refused · 3 ring refused · 4 advance filled
-- (sale agent, expected back = ready date) · 5 lender sees it on the 📋 to-do
-- once due · 6 reminder to lender + sale agent, weekly cadence · 7 another
-- agent cannot tick returned (RLS) · 8 lender ticks returned · 9 undo of a
-- handover removes an owed advance.
do $$
declare j jsonb := '{}'; lender bigint := 1775472202840; seller bigint := 1775637005921;
 C bigint := 990000000000502; PU bigint := 990000000000506; d date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
 diC bigint; diR bigint; diC2 bigint; n int; ok boolean;
begin
 j := j || jsonb_build_object('1_eligible', (select json_object_agg(t, delivery_advance_allowed(t)) from unnest(array[
   '元极大通', 'Calligraphy Series: 元亨利貞', '上龙柄', '财库，财托', '六曜指环 Support Power Ring', '专案 Project Plan', '灵活 Flexible Plan']) t));
 insert into customers (id, full_name, responsible_agent_id, created_at, updated_at) values (C, 'TEST Advance', seller, now(), now());
 insert into purchases (id, customer_id, date, item, amount, status, payment_method, agent_id, created_at, updated_at)
 values (PU, C, d - 10, 'TEST 元极大通 + Power Ring', 16000, 'COMPLETED', 'Cash', seller, now(), now());
 insert into delivery_items (customer_id, purchase_id, item_name, qty, status, expected_ready_date) values (C, PU, '元极大通', 1, 'pending', d + 100) returning id into diC;
 insert into delivery_items (customer_id, purchase_id, item_name, qty, status) values (C, PU, '六曜指环 Support Power Ring', 1, 'pending') returning id into diR;
 insert into delivery_items (customer_id, purchase_id, item_name, qty, status) values (C, PU, '大满福 Da Man Fu', 1, 'pending') returning id into diC2;
 j := j || jsonb_build_object('1b_rpc', (select json_agg(x) from delivery_advance_eligible(array[diC, diR, diC2]) x));
 begin
   insert into delivery_advances (delivery_item_id, lender_agent_id) values (diC, lender);
   j := j || jsonb_build_object('2_before_handover', 'ALLOWED (bad)');
 exception when others then j := j || jsonb_build_object('2_before_handover', 'refused: ' || sqlerrm); end;
 update delivery_items set status = 'picked_up', handover_date = d, photos = '["delivery/test/a.jpg"]'::jsonb where id in (diC, diR, diC2);
 begin
   insert into delivery_advances (delivery_item_id, lender_agent_id) values (diR, lender);
   j := j || jsonb_build_object('3_ring', 'ALLOWED (bad)');
 exception when others then j := j || jsonb_build_object('3_ring', 'refused: ' || sqlerrm); end;
 insert into delivery_advances (delivery_item_id, lender_agent_id) values (diC, lender);
 j := j || jsonb_build_object('4_filled', (select row_to_json(x) from (select item_name, given_date, expected_back, sale_agent_id = seller as sale_agent_ok, status, customer_id = C as cust_ok from delivery_advances where delivery_item_id = diC) x));
 j := j || jsonb_build_object('5_todo_not_yet', (select count(*) from journey_todo_for(lender, 200) t where t.kind = 'advance' and t.customer_id = C));
 update delivery_advances set expected_back = d where delivery_item_id = diC;
 j := j || jsonb_build_object('5_todo_due', (select json_agg(t.why) from journey_todo_for(lender, 200) t where t.kind = 'advance' and t.customer_id = C));
 n := queue_advance_reminders();
 j := j || jsonb_build_object('6_pushed', (select json_agg(json_build_object('u', user_id = lender, 't', title, 'b', body)) from notification_outbox
     where kind = 'advance_due' and dedupe_key like 'advance_due:' || (select id from delivery_advances where delivery_item_id = diC) || ':%'));
 update delivery_advances set expected_back = d - 3 where delivery_item_id = diC;
 j := j || jsonb_build_object('6b_day3_no_push', queue_advance_reminders());
 -- (same test day as the first push → clear it so the day-7 dedupe key is free)
 delete from notification_outbox where kind = 'advance_due';
 update delivery_advances set expected_back = d - 7 where delivery_item_id = diC;
 j := j || jsonb_build_object('6c_day7_push', queue_advance_reminders());
 -- 7: as the seller (not the lender, L5 but not admin) → update blocked by RLS
 perform set_config('request.jwt.claims', json_build_object('sub', '29df4985-fe38-4435-9a58-b0b9bffb13cc', 'role', 'authenticated')::text, true);
 set local role authenticated;
 update delivery_advances set status = 'returned', returned_date = d where delivery_item_id = diC;
 get diagnostics n = row_count;
 j := j || jsonb_build_object('7_other_agent_rows', n, '7_seller_can_see', (select count(*) from delivery_advances where delivery_item_id = diC));
 reset role;
 -- 8: as the lender (Lau Mian Mian)
 perform set_config('request.jwt.claims', json_build_object('sub', 'b55255aa-4bd1-4690-aa1c-e8abede53239', 'role', 'authenticated')::text, true);
 set local role authenticated;
 update delivery_advances set status = 'returned', returned_date = d where delivery_item_id = diC;
 get diagnostics n = row_count;
 reset role;
 j := j || jsonb_build_object('8_lender_rows', n, '8_state', (select status || ' by ' || coalesce((returned_by = lender)::text, 'null') from delivery_advances where delivery_item_id = diC));
 -- 9: second piece lent, then the customer handover is undone → advance removed
 insert into delivery_advances (delivery_item_id, lender_agent_id) values (diC2, lender);
 update delivery_items set status = 'pending', handover_date = null where id = diC2;
 j := j || jsonb_build_object('9_after_undo', (select count(*) from delivery_advances where delivery_item_id = diC2));
 raise exception 'TEST %', j;
end $$;
