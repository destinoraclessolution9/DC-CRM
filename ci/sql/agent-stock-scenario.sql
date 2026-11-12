-- ci/sql/agent-stock-scenario.sql — scenario for migrations/2026-11-12_agent_stock.sql.
-- Run via the Management API after the migration (or in the same request before
-- applying it: the RAISE at the end rolls everything back). Expect:
--  0 names → stock product (longest Chinese name wins, promo = plain product,
--    traditional characters, English fallback); 財庫 / 天之喜 now allowed
--  1 by hand (as the agent): add own stock; not for someone else, no 'lent' by
--    hand, no power ring
--  2 handover from the agent's stock → in hand −1, lent +1, owed back date;
--    ↩ returned → back in hand; record removed / handover undone → back in hand;
--    lender changed → moves to the new lender; an item with no product → own row
--  3 who sees: the agent, their upline, admin; an outside agent sees nothing;
--    counts for the handover list; delete own typed line only; anon refused
do $$
declare j jsonb := '{}'; lau bigint := 1775472202840; oo bigint := 1775637005921; adm bigint := 9999;
 lau_sub text := 'b55255aa-4bd1-4690-aa1c-e8abede53239'; oo_sub text := '29df4985-fe38-4435-9a58-b0b9bffb13cc';
 adm_sub text := 'f425e89a-2bb0-4db4-8978-1884e82dbbff'; str_sub text; str_id bigint;
 d date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
 C1 bigint := 990000000001001; C2 bigint := 990000000001002; C3 bigint := 990000000001003; C4 bigint := 990000000001004;
 P1 bigint := 990000000001011; P2 bigint := 990000000001012; P3 bigint := 990000000001013; P4 bigint := 990000000001014;
 pid_yh bigint; pid_ring bigint; i1 bigint; i2 bigint; i3 bigint; i4 bigint; a1 bigint; a2 bigint; a3 bigint; a4 bigint;
 mv bigint; n int; t text;
begin
 select p.id into pid_yh from public.agent_stock_products() p where p.name like '元亨利贞%';
 select id into pid_ring from public.products where subcategory = 'Power Ring' limit 1;
 select u.id, u.auth_user_id::text into str_id, str_sub from public.users u
  where u.auth_user_id is not null and u.status = 'active' and u.role ~* 'level\s*([3-9]|1[0-2])\y' and u.id not in (lau, oo)
    and not exists (with recursive tr as (select u.id as id union select x.id from public.users x join tr on x.reporting_to = tr.id)
                    select 1 from tr where tr.id = lau)
  limit 1;

 -- 0 names
 j := j || jsonb_build_object('0_match', (select jsonb_object_agg(s, coalesce((select name from public.products where id = public.agent_stock_product(s)), '∅')) from unnest(array[
      '元亨利贞', '元亨利貞', '新元亨利贞', 'Calligraphy Series: 元亨利贞', '上龙柄（推介特价） Shang Long Bing Promo 3.0', 'BAO WANG XIANG 2',
      '宝王象2 Bao Wang Xiang 2', '宝王象', '天至喜 1', '天之喜 2', 'TIAN ZHI XI 4', '財庫', '财库，财托', '财托',
      '经传录（推介特价） Jing Chuan Lu Promo 3.0', '上贵文昌经传录', '六曜指环 Support Power Ring', 'something else']) s));
 j := j || jsonb_build_object('0_allowed', (select jsonb_object_agg(s, public.delivery_advance_allowed(s)) from unnest(array['財庫', '天之喜 2', '元亨利貞', '六曜指环 Support Power Ring', '专案 Project Plan']) s));
 j := j || jsonb_build_object('0_stock_products', (select count(*) from public.agent_stock_products()));
 -- every lendable item already sold → which product (for review)
 j := j || jsonb_build_object('0_live_items', (select jsonb_object_agg(x.item_name, coalesce((select name from public.products where id = public.agent_stock_product(x.item_name)), '∅'))
                                              from (select distinct di.item_name from public.delivery_items di where public.delivery_advance_allowed(di.item_name)) x));

 -- 1 by hand, as Lau
 perform set_config('request.jwt.claims', json_build_object('sub', lau_sub, 'role', 'authenticated')::text, true);
 set local role authenticated;
 insert into public.agent_stock_moves (agent_id, product_id, item_name, qty, kind, move_date, note) values (lau, pid_yh, 'x', 3, 'added', d - 10, 'TEST') returning id into mv;
 j := j || jsonb_build_object('1_added', (select json_build_object('name', item_name, 'by_me', created_by = lau) from public.agent_stock_moves where id = mv));
 begin insert into public.agent_stock_moves (agent_id, product_id, item_name, qty, kind) values (oo, pid_yh, 'x', 1, 'added');
       j := j || jsonb_build_object('1_for_someone_else', 'ALLOWED (bad)');
 exception when others then j := j || jsonb_build_object('1_for_someone_else', 'refused'); end;
 begin insert into public.agent_stock_moves (agent_id, product_id, item_name, qty, kind) values (lau, pid_yh, 'x', -1, 'lent');
       j := j || jsonb_build_object('1_lent_by_hand', 'ALLOWED (bad)');
 exception when others then j := j || jsonb_build_object('1_lent_by_hand', 'refused'); end;
 begin insert into public.agent_stock_moves (agent_id, product_id, item_name, qty, kind) values (lau, pid_ring, 'x', 1, 'added');
       j := j || jsonb_build_object('1_power_ring', 'ALLOWED (bad)');
 exception when others then j := j || jsonb_build_object('1_power_ring', 'refused: ' || sqlerrm); end;
 j := j || jsonb_build_object('1_balance', (select json_agg(json_build_object('item', item_name, 'in', in_hand, 'lent', lent_out, 'owned', owned)) from public.agent_stock_balance(lau)));
 reset role;

 -- 2 handovers from Lau's stock (written as the system, like the app's handover)
 insert into public.customers (id, full_name, phone, responsible_agent_id, created_at, updated_at) values
   (C1, 'TEST Stock A', null, oo, now(), now()), (C2, 'TEST Stock B', null, oo, now(), now()),
   (C3, 'TEST Stock C', null, oo, now(), now()), (C4, 'TEST Stock D', null, oo, now(), now());
 insert into public.purchases (id, customer_id, date, item, amount, status, payment_method, agent_id, invoice, created_at, updated_at) values
   (P1, C1, d - 20, 'TEST 元亨利貞', 5980, 'COMPLETED', 'Cash', oo, '9991011', now(), now()),
   (P2, C2, d - 20, 'TEST 元亨利贞', 5980, 'COMPLETED', 'Cash', oo, '9991012', now(), now()),
   (P3, C3, d - 20, 'TEST 元亨利贞', 5980, 'COMPLETED', 'Cash', oo, '9991013', now(), now()),
   (P4, C4, d - 20, 'TEST 宝王象', 26980, 'COMPLETED', 'Cash', oo, '9991014', now(), now());
 insert into public.delivery_items (customer_id, purchase_id, item_name, status, expected_ready_date) values (C1, P1, '元亨利貞', 'pending', d + 90) returning id into i1;
 insert into public.delivery_items (customer_id, purchase_id, item_name, status, expected_ready_date) values (C2, P2, '元亨利贞 Yuan Heng Li Zhen', 'pending', d + 95) returning id into i2;
 insert into public.delivery_items (customer_id, purchase_id, item_name, status, expected_ready_date) values (C3, P3, '元亨利贞', 'pending', d + 99) returning id into i3;
 insert into public.delivery_items (customer_id, purchase_id, item_name, status, expected_ready_date) values (C4, P4, '宝王象', 'pending', d + 99) returning id into i4;
 update public.delivery_items set status = 'delivered', handover_date = d - 1, photos = '["delivery/test/x.jpg"]'::jsonb where id in (i1, i2, i3, i4);
 insert into public.delivery_advances (delivery_item_id, lender_agent_id, given_date) values (i1, lau, d - 1) returning id into a1;
 j := j || jsonb_build_object('2_after_lend', (select json_agg(json_build_object('in', in_hand, 'lent', lent_out, 'owned', owned, 'back_in_days', next_back - d, 'last', last_kind)) from public.agent_stock_balance(lau)));
 j := j || jsonb_build_object('2_lent_line', (select json_build_object('qty', qty, 'note', note, 'date', move_date - d, 'same_product', product_id = pid_yh) from public.agent_stock_moves where advance_id = a1 and kind = 'lent'));
 update public.delivery_advances set status = 'returned', returned_date = d where id = a1;
 j := j || jsonb_build_object('2_after_return', (select json_agg(json_build_object('in', in_hand, 'lent', lent_out, 'back', next_back)) from public.agent_stock_balance(lau)));
 insert into public.delivery_advances (delivery_item_id, lender_agent_id, given_date) values (i2, lau, d - 1) returning id into a2;
 delete from public.delivery_advances where id = a2;
 j := j || jsonb_build_object('2_after_record_removed', (select json_agg(json_build_object('in', in_hand, 'lent', lent_out)) from public.agent_stock_balance(lau)));
 insert into public.delivery_advances (delivery_item_id, lender_agent_id, given_date) values (i3, lau, d - 1) returning id into a3;
 update public.delivery_items set status = 'pending', handover_date = null where id = i3;
 j := j || jsonb_build_object('2_after_handover_undone', (select json_agg(json_build_object('in', in_hand, 'lent', lent_out, 'adv_left', (select count(*) from public.delivery_advances where id = a3))) from public.agent_stock_balance(lau)));
 insert into public.delivery_advances (delivery_item_id, lender_agent_id, given_date) values (i2, lau, d - 1) returning id into a2;
 update public.delivery_advances set lender_agent_id = oo where id = a2;
 j := j || jsonb_build_object('2_lender_changed', json_build_object(
      'lau', (select json_agg(json_build_object('in', in_hand, 'lent', lent_out)) from public.agent_stock_balance(lau)),
      'oo', (select json_agg(json_build_object('item', item_name, 'in', in_hand, 'lent', lent_out, 'owned', owned)) from public.agent_stock_balance(oo))));
 insert into public.delivery_advances (delivery_item_id, lender_agent_id, given_date) values (i4, lau, d - 1) returning id into a4;
 j := j || jsonb_build_object('2_no_product', (select json_agg(json_build_object('item', item_name, 'pid', product_id, 'in', in_hand)) from public.agent_stock_balance(lau) where product_id is null));
 j := j || jsonb_build_object('2_history_kinds', (select json_agg(kind || ' ' || qty order by id) from public.agent_stock_moves where agent_id = lau));

 -- 3 who sees
 perform set_config('request.jwt.claims', json_build_object('sub', oo_sub, 'role', 'authenticated')::text, true);
 set local role authenticated;
 j := j || jsonb_build_object('3_upline_sees_lau', (select count(*) from public.agent_stock_balance(lau)));
 begin insert into public.agent_stock_moves (agent_id, product_id, item_name, qty, kind) values (lau, pid_yh, 'x', 1, 'added');
       j := j || jsonb_build_object('3_upline_adds_for_lau', 'ALLOWED (bad)');
 exception when others then j := j || jsonb_build_object('3_upline_adds_for_lau', 'refused'); end;
 reset role;
 if str_sub is not null then
   perform set_config('request.jwt.claims', json_build_object('sub', str_sub, 'role', 'authenticated')::text, true);
   set local role authenticated;
   j := j || jsonb_build_object('3_outsider_sees_lau', (select count(*) from public.agent_stock_balance(lau)));
   j := j || jsonb_build_object('3_outsider_counts', (select count(*) from public.agent_stock_counts('元亨利贞') where agent_id = lau));
   reset role;
 else j := j || jsonb_build_object('3_outsider_sees_lau', 'no outsider found'); end if;
 perform set_config('request.jwt.claims', json_build_object('sub', adm_sub, 'role', 'authenticated')::text, true);
 set local role authenticated;
 j := j || jsonb_build_object('3_admin_sees', (select count(*) from public.agent_stock_balance(null) where agent_id in (lau, oo)));
 insert into public.agent_stock_moves (agent_id, product_id, item_name, qty, kind, note) values (oo, pid_yh, 'x', 2, 'added', 'TEST admin') ;
 j := j || jsonb_build_object('3_admin_added_for_oo', (select json_agg(json_build_object('in', in_hand, 'owned', owned)) from public.agent_stock_balance(oo) where product_id = pid_yh));
 reset role;
 perform set_config('request.jwt.claims', json_build_object('sub', lau_sub, 'role', 'authenticated')::text, true);
 set local role authenticated;
 j := j || jsonb_build_object('3_counts_for_handover', (select json_agg(json_build_object('agent', case agent_id when lau then 'lau' when oo then 'oo' else agent_id::text end, 'in', in_hand)) from public.agent_stock_counts('元亨利貞')));
 delete from public.agent_stock_moves where agent_id = lau and kind = 'lent';
 get diagnostics n = row_count;
 j := j || jsonb_build_object('3_delete_lent_line', n);
 delete from public.agent_stock_moves where id = mv;
 get diagnostics n = row_count;
 j := j || jsonb_build_object('3_delete_own_added', n);
 reset role;
 perform set_config('request.jwt.claims', '', true);
 set local role anon;
 begin perform public.agent_stock_balance(null); j := j || jsonb_build_object('3_anon', 'ALLOWED (bad)');
 exception when others then j := j || jsonb_build_object('3_anon', 'refused'); end;
 begin perform count(*) from public.agent_stock_moves; j := j || jsonb_build_object('3_anon_table', 'ALLOWED (bad)');
 exception when others then j := j || jsonb_build_object('3_anon_table', 'refused'); end;
 reset role;

 raise exception 'SCENARIO %', j;
end $$;
