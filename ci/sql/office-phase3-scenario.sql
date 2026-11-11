-- ci/sql/office-phase3-scenario.sql — scenario for migrations/2026-11-11_office_phase3.sql.
-- Run via the Management API after the migration (or in the same request before
-- applying it: the RAISE at the end rolls everything back). Expect:
--  1 ready dates: 天至喜 1/2 = 120 days, 天至喜 3/4 = 270, TIAN ZHI XI 1 = 120,
--    天之喜 2 = 120, traditional 元亨利貞 = 120, other groups unchanged
--  2 product group of a sold piece
--  3 a lent piece the office released: owed back from the office date; a new
--    advance on a released item starts there too
--  4 reminders: lender + sale agent on day 3 ("ready at the office since …"),
--    not on day 4; a second run adds nothing
--  5 the lender's to-do row says where the piece is
--  6 office_lead_times: history + a live sheet line, staff only
do $$
declare j jsonb := '{}'; seller bigint := 1775637005921; lender bigint := 1775472202840;
 staff_sub text := '29df4985-fe38-4435-9a58-b0b9bffb13cc';
 d date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
 C1 bigint := 990000000000901; C2 bigint := 990000000000902; C3 bigint := 990000000000903;
 P1 bigint := 990000000000911; P2 bigint := 990000000000912; P3 bigint := 990000000000913;
 i1 bigint; i2 bigint; i3 bigint; a1 bigint; a2 bigint; a3 bigint; nid bigint; n int;
begin
 -- 1 + 2
 j := j || jsonb_build_object('1_lead', (select jsonb_object_agg(t, (journey_item_profile(t)).lead_days) from unnest(array[
      '天至喜 1', '天至喜 2', '天至喜 3', '天至喜4', 'TIAN ZHI XI 1', 'Feng Shui Product: 天之喜 2', '元亨利貞',
      'Calligraphy Series: 元亨利贞', '宝王象 2', '富田盘 1', '六曜指环 Support Power Ring', '专案 Project Plan',
      '灵活 Flexible Plan', '财库，财托', '天至喜1 Tian Zhi Xi 1']) t));
 j := j || jsonb_build_object('2_group', (select jsonb_object_agg(t, office_lead_group(t)) from unnest(array[
      '天道酬勤', '元亨利貞', '天至喜 1', 'PROSPERITY POWER RING / RINGSIZE 22', '財庫', 'something else']) t));

 -- 3: three lent pieces (财库), handed over from the lender's stock
 insert into customers (id, full_name, phone, responsible_agent_id, created_at, updated_at) values
   (C1, 'TEST Lend A', '0123456789', seller, now(), now()), (C2, 'TEST Lend B', null, seller, now(), now()),
   (C3, 'TEST Lend C', null, seller, now(), now());
 insert into purchases (id, customer_id, date, item, amount, status, payment_method, agent_id, invoice, created_at, updated_at) values
   (P1, C1, d - 100, 'TEST 财库', 8000, 'COMPLETED', 'Cash', seller, '9990911', now(), now()),
   (P2, C2, d - 100, 'TEST 财库', 8000, 'COMPLETED', 'Cash', seller, '9990912', now(), now()),
   (P3, C3, d - 100, 'TEST 财库', 8000, 'COMPLETED', 'Cash', seller, '9990913', now(), now());
 insert into delivery_items (customer_id, purchase_id, item_name, status, expected_ready_date) values (C1, P1, '财库', 'pending', d + 60) returning id into i1;
 insert into delivery_items (customer_id, purchase_id, item_name, status, expected_ready_date) values (C2, P2, '财库', 'pending', d + 60) returning id into i2;
 insert into delivery_items (customer_id, purchase_id, item_name, status, expected_ready_date) values (C3, P3, '财库', 'pending', d + 60) returning id into i3;
 update delivery_items set status = 'picked_up', handover_date = d - 30, photos = '["delivery/test/x.jpg"]'::jsonb where id in (i1, i2);
 insert into delivery_advances (delivery_item_id, lender_agent_id, given_date) values (i1, lender, d - 30) returning id into a1;
 insert into delivery_advances (delivery_item_id, lender_agent_id, given_date) values (i2, lender, d - 30) returning id into a2;
 j := j || jsonb_build_object('3_before', (select expected_back - d from delivery_advances where id = a1));
 update delivery_items set office_ready_date = d - 3, office_ready_place = 'LVL 20' where id = i1;
 update delivery_items set office_ready_date = d - 4, office_ready_place = 'LVL 20' where id = i2;
 j := j || jsonb_build_object('3_after', (select json_build_object('a1', (select expected_back - d from delivery_advances where id = a1),
                                                                  'a2', (select expected_back - d from delivery_advances where id = a2))));
 -- the office released i3 before the customer got the lender's piece
 update delivery_items set office_ready_date = d - 10 where id = i3;
 update delivery_items set status = 'picked_up', handover_date = d - 2, photos = '["delivery/test/x.jpg"]'::jsonb where id = i3;
 insert into delivery_advances (delivery_item_id, lender_agent_id, given_date) values (i3, lender, d - 2) returning id into a3;
 j := j || jsonb_build_object('3_new_advance', (select expected_back - d from delivery_advances where id = a3));

 -- 4: reminders
 delete from notification_outbox where dedupe_key like 'advance_due:' || a1 || ':%' or dedupe_key like 'advance_due:' || a2 || ':%' or dedupe_key like 'advance_due:' || a3 || ':%';
 perform queue_advance_reminders();
 j := j || jsonb_build_object('4_push', (select json_agg(json_build_object('adv', case when o.dedupe_key like 'advance_due:' || a1 || ':%' then 'a1'
                                                 when o.dedupe_key like 'advance_due:' || a2 || ':%' then 'a2' else 'a3' end,
                                          'to', case o.user_id when lender then 'lender' when seller then 'seller' end, 'title', o.title, 'body', o.body) order by o.dedupe_key)
                                    from notification_outbox o where o.dedupe_key like 'advance_due:' || a1 || ':%' or o.dedupe_key like 'advance_due:' || a2 || ':%'
                                       or o.dedupe_key like 'advance_due:' || a3 || ':%'));
 j := j || jsonb_build_object('4_second_run', (select count(*) from notification_outbox where dedupe_key like 'advance_due:' || a1 || ':%'));
 perform queue_advance_reminders();
 j := j || jsonb_build_object('4_after_second_run', (select count(*) from notification_outbox where dedupe_key like 'advance_due:' || a1 || ':%'));

 -- 5: the lender's to-do
 j := j || jsonb_build_object('5_todo', (select json_object_agg(r.name, r.why) from journey_todo_rows(lender, 1000, false) r
                                         where r.customer_id in (C1, C2, C3) and r.kind = 'advance'));

 -- 6: real production times, with one live sheet line (TEST 财库 sold 100 days ago, ready today)
 insert into office_notices (photo_path, status, title, collect_date, place) values ('office-notices/test/p3.jpg', 'read', 'TEST', d, 'lvl 20') returning id into nid;
 insert into office_notice_lines (notice_id, line_no, sn_raw, customer, item) values (nid, 1, '9990911', 'TEST LEND A', '財庫');
 perform set_config('request.jwt.claims', json_build_object('sub', staff_sub, 'role', 'authenticated')::text, true);
 set local role authenticated;
 j := j || jsonb_build_object('6_times', (select json_agg(json_build_object('g', grp, 'set', set_days, 'n', pieces, 'mid', median_days, 'min', min_days, 'max', max_days, 'eg', examples))
                                          from office_lead_times()));
 reset role;
 perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-000000000000', 'role', 'authenticated')::text, true);
 set local role authenticated;
 begin
   perform office_lead_times();
   j := j || jsonb_build_object('6_not_staff', 'ALLOWED (bad)');
 exception when others then j := j || jsonb_build_object('6_not_staff', 'refused: ' || sqlerrm); end;
 reset role;

 raise exception 'SCENARIO %', j;
end $$;
