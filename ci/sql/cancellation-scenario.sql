-- ci/sql/cancellation-scenario.sql — scenario for migrations/2026-10-22_sale_cancellations.sql.
-- Run AFTER the migration; one DO block ending in RAISE EXCEPTION → all TEST rows roll back.
do $$
declare j jsonb := '{}'; lau text := 'b55255aa-4bd1-4690-aa1c-e8abede53239'; chen text := 'bc126e85-9e12-48cf-8419-0089483b62c1';
 C bigint := 990000000001002; PU bigint := 990000000001006; PD bigint := 990000000001007;
 d date := (now() at time zone 'Asia/Kuala_Lumpur')::date; cid bigint; di bigint; n int;
begin
 insert into customers (id, full_name, responsible_agent_id, created_at, updated_at) values (C, 'TEST Cancel', 1775472202840, now(), now());
 -- a POP sale (auto months in the past, due months ahead) with a pending item
 insert into purchases (id, customer_id, date, item, amount, status, payment_method, installment_tenure, pop_monthly_amount, agent_id, invoice, created_at, updated_at, delivery_status)
 values (PU, C, date '2026-08-05', 'TEST 元极大通', 12000, 'COMPLETED', 'POP', 12, 1000, 1775472202840, 'TEST-CXL', now(), now(), 'Pending Delivery');
 insert into delivery_items (customer_id, purchase_id, item_name, qty, status) values (C, PU, 'TEST 元极大通', 1, 'pending') returning id into di;
 -- a second sale already delivered
 insert into purchases (id, customer_id, date, item, amount, status, payment_method, agent_id, created_at, updated_at, delivery_status)
 values (PD, C, date '2026-08-05', 'TEST 大满福', 5000, 'COMPLETED', 'Cash', 1775472202840, now(), now(), 'Delivered');
 j := j || jsonb_build_object('0_pop_before', (select json_object_agg(status, k) from (select status, count(*) k from pop_installments where purchase_id = PU group by 1) x));

 perform set_config('request.jwt.claims', json_build_object('sub', lau, 'role', 'authenticated')::text, true);
 set local role authenticated;
 begin perform cancel_request(PD, d, 'changed mind', 'MBB', '1234 5678 9012', 'TEST Cancel', 'cxl/x.pdf');
       j := j || jsonb_build_object('1_delivered', 'ALLOWED (bad)');
 exception when others then j := j || jsonb_build_object('1_delivered', 'refused: ' || sqlerrm); end;
 begin perform cancel_request(PU, d, 'changed mind', 'MBB', '1234', 'TEST Cancel', '');
       j := j || jsonb_build_object('1b_no_file', 'ALLOWED (bad)');
 exception when others then j := j || jsonb_build_object('1b_no_file', 'refused: ' || sqlerrm); end;
 cid := cancel_request(PU, d - 20, 'Family objection', 'Maybank', '1234 5678 9012', 'TEST Cancel', 'cancellations/test/req.pdf', 'request.pdf');
 begin perform cancel_request(PU, d, 'again', 'MBB', '1', 'x', 'cxl/y.pdf');
       j := j || jsonb_build_object('2_duplicate', 'ALLOWED (bad)');
 exception when others then j := j || jsonb_build_object('2_duplicate', 'refused: ' || sqlerrm); end;
 reset role;
 j := j || jsonb_build_object('2_case', (select row_to_json(x) from (select status, bank_account, amount_paid, (select sum(amount) from pop_installments where purchase_id = PU and status in ('due','lapsed')) as pop_unpaid from sale_cancellations where id = cid) x));
 -- 3: reminder — acceptance not back after 14+ days (request 20 days ago → day 21 = multiple of 7)
 update sale_cancellations set requested_at = d - 21 where id = cid;
 j := j || jsonb_build_object('3_reminder_requested', queue_cancellation_reminders());
 -- 4: an outsider (fellow agent Chen) cannot sign
 perform set_config('request.jwt.claims', json_build_object('sub', chen, 'role', 'authenticated')::text, true);
 set local role authenticated;
 begin perform cancel_sign(cid, d, 'cxl/acc.pdf', 'acc.pdf', 12000, 500, 11500, 6, (d + interval '1 month')::date);
       j := j || jsonb_build_object('4_outsider', 'ALLOWED (bad)');
 exception when others then j := j || jsonb_build_object('4_outsider', 'refused: ' || sqlerrm); end;
 reset role;
 -- 5: the agent signs → sale cancelled, POP to come waived, history kept, item cancelled
 perform set_config('request.jwt.claims', json_build_object('sub', lau, 'role', 'authenticated')::text, true);
 set local role authenticated;
 perform cancel_sign(cid, d, 'cancellations/test/acc.pdf', 'acceptance.pdf', 12000, 500, 11500, 6, (d + interval '1 month')::date);
 reset role;
 j := j || jsonb_build_object('5_sale', (select status || '/' || delivery_status from purchases where id = PU),
     '5_pop', (select json_object_agg(status, k) from (select status, count(*) k from pop_installments where purchase_id = PU group by 1) x),
     '5_item', (select status from delivery_items where id = di),
     '5_case', (select row_to_json(x) from (select status, refund_total, refund_months, first_refund_month, admin_fee from sale_cancellations where id = cid) x),
     '5_won_excluded', (select count(*) from purchases where id = PU and coalesce(status, '') !~* 'cancel|refund|void'));
 -- 6: undo → restored
 set local role authenticated;
 perform cancel_undo_sign(cid);
 reset role;
 j := j || jsonb_build_object('6_after_undo', (select status || '/' || delivery_status from purchases where id = PU),
     '6_pop', (select json_object_agg(status, k) from (select status, count(*) k from pop_installments where purchase_id = PU group by 1) x),
     '6_item', (select status from delivery_items where id = di), '6_case', (select status from sale_cancellations where id = cid));
 -- 7: sign again, refund past its expected end → reminder, then complete
 set local role authenticated;
 perform cancel_sign(cid, d, 'cancellations/test/acc.pdf', 'acceptance.pdf', 12000, 500, 11500, 2, date '2026-07-01');
 reset role;
 j := j || jsonb_build_object('7_end_reminder_window', queue_cancellation_reminders());
 set local role authenticated;
 begin perform cancel_complete(cid, d + 5);
       j := j || jsonb_build_object('7b_future', 'ALLOWED (bad)');
 exception when others then j := j || jsonb_build_object('7b_future', 'refused: ' || sqlerrm); end;
 perform cancel_complete(cid, d);
 reset role;
 j := j || jsonb_build_object('7_done', (select status || ' ' || refunded_at from sale_cancellations where id = cid));
 raise exception 'TEST %', j;
end $$;
