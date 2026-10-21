-- ci/sql/pop-lapse-scenario.sql — scenario for migrations/2026-10-21_pop_lapse_receipts.sql.
-- Run AFTER the migration; one DO block ending in RAISE EXCEPTION → all TEST rows roll back.
-- Expect: 1 a sale from 5 months ago → past months auto, future due · 2 agent marks 2
-- months lapsed (lapsed_at/by set) · 3 to-do rows · 4 day-3 reminder · 5 an agent outside
-- the team cannot act · 6 one receipt pays both (amount incl. late fee) · 7 summary ·
-- 8 undo → both lapsed again · 9 receipt needs a file / only lapsed months.
do $$
declare j jsonb := '{}'; ag bigint := 1775472202840; other bigint := 1776065739138;
 C bigint := 990000000000702; PU bigint := 990000000000706; d date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
 i1 bigint; i2 bigint; i3 bigint; rid bigint; n int;
begin
 insert into customers (id, full_name, responsible_agent_id, created_at, updated_at) values (C, 'TEST POP Lapse', ag, now(), now());
 insert into purchases (id, customer_id, date, item, amount, status, payment_method, installment_tenure, pop_monthly_amount, agent_id, created_at, updated_at)
 values (PU, C, date '2026-05-05', 'TEST 六曜指环 Support Power Ring', 12000, 'COMPLETED', 'POP', 24, 500, ag, now(), now());
 j := j || jsonb_build_object('1_status', (select json_object_agg(status, cnt) from (select status, count(*) cnt from pop_installments where purchase_id = PU group by 1) x));
 -- Oct 5 is the only month since tracking began that is already past (auto);
 -- pretend Nov 5 has passed too so one receipt can cover two lapsed months
 select id into i1 from pop_installments where purchase_id = PU and due_date = date '2026-10-05';
 select id into i2 from pop_installments where purchase_id = PU and due_date = date '2026-11-05';
 update pop_installments set status = 'auto' where id = i2;
 select id into i3 from pop_installments where purchase_id = PU and status = 'due' order by seq limit 1;
 -- 2: as the agent (Lau Mian Mian)
 perform set_config('request.jwt.claims', json_build_object('sub', 'b55255aa-4bd1-4690-aa1c-e8abede53239', 'role', 'authenticated')::text, true);
 set local role authenticated;
 update pop_installments set status = 'lapsed' where id in (i1, i2);
 get diagnostics n = row_count;
 reset role;
 j := j || jsonb_build_object('2_marked', n, '2_by', (select bool_and(lapsed_by = ag and lapsed_at = d) from pop_installments where id in (i1, i2)));
 j := j || jsonb_build_object('3_todo', (select json_agg(t.why) from journey_todo_for(ag, 200) t where t.customer_id = C));
 update pop_installments set lapsed_at = d - 3 where id in (i1, i2);
 j := j || jsonb_build_object('4_reminders', pop_daily());
 -- 5: a fellow agent (Chen Mei Lin, L9) cannot record a receipt or mark
 perform set_config('request.jwt.claims', json_build_object('sub', 'bc126e85-9e12-48cf-8419-0089483b62c1', 'role', 'authenticated')::text, true);
 set local role authenticated;
 begin
   perform pop_record_receipt(array[i1, i2], d, 1050, 'pop/test/r.jpg');
   j := j || jsonb_build_object('5_outsider', 'ALLOWED (bad)');
 exception when others then j := j || jsonb_build_object('5_outsider', 'refused: ' || sqlerrm); end;
 update pop_installments set status = 'auto' where id = i1;
 get diagnostics n = row_count;
 j := j || jsonb_build_object('5_outsider_update_rows', n);
 reset role;
 -- 6: back as the agent: one receipt for both months, RM1,050 incl. late fee
 perform set_config('request.jwt.claims', json_build_object('sub', 'b55255aa-4bd1-4690-aa1c-e8abede53239', 'role', 'authenticated')::text, true);
 set local role authenticated;
 begin
   perform pop_record_receipt(array[i1, i2], d, 1050, '');
   j := j || jsonb_build_object('9_no_file', 'ALLOWED (bad)');
 exception when others then j := j || jsonb_build_object('9_no_file', 'refused: ' || sqlerrm); end;
 begin
   perform pop_record_receipt(array[i3], d, 500, 'pop/test/x.jpg');
   j := j || jsonb_build_object('9_not_lapsed', 'ALLOWED (bad)');
 exception when others then j := j || jsonb_build_object('9_not_lapsed', 'refused: ' || sqlerrm); end;
 j := j || jsonb_build_object('5b_states_before_pay', (select json_agg(status) from pop_installments where id in (i1, i2)));
 begin
 rid := pop_record_receipt(array[i1, i2], d, 1050, 'pop/test/r.jpg', 'receipt.jpg', 'MBB123', 'incl. RM50 late fee');
 exception when others then raise exception 'TEST %', j || jsonb_build_object('6_ERR', sqlerrm); end;
 j := j || jsonb_build_object('6_paid', (select json_agg(json_build_object('s', status, 'rid', receipt_id = rid, 'pd', paid_date = d, 'lapsed_kept', lapsed_at is not null)) from pop_installments where id in (i1, i2)),
     '6_receipt', (select row_to_json(x) from (select amount, bank_ref, note, uploaded_by = ag ok from pop_receipts where id = rid) x),
     '7_summary', (select row_to_json(s) from pop_summary() s));
 reset role;
 j := j || jsonb_build_object('3b_todo_after', (select count(*) from journey_todo_for(ag, 200) t where t.customer_id = C and t.kind = 'pop'));
 -- 8: undo (as the uploader)
 set local role authenticated;
 perform pop_undo_receipt(rid);
 reset role;
 j := j || jsonb_build_object('8_after_undo', (select json_agg(status) from pop_installments where id in (i1, i2)), '8_receipt_gone', (select count(*) = 0 from pop_receipts where id = rid));
 raise exception 'TEST %', j;
end $$;
