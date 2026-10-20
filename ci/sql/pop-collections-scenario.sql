-- ci/sql/pop-collections-scenario.sql — scenario for
-- migrations/2026-10-20_pop_collections.sql. Run via the Management API AFTER
-- the migration: one DO block ending in RAISE EXCEPTION, so every TEST row
-- rolls back and the result comes back in the error message.
-- Expect: 1 new POP sale → 12 rows due, first = sale + 1 month · 2 terms change
-- before anything is ticked → rebuilt to 10 · 3 a ticked plan is NOT rebuilt ·
-- 4 failed charge → agent to-do row kind 'pop' · 5 viewer RPCs (Kean) ·
-- 6 cancel → untouched due rows removed, paid/failed kept · 7 bank EPP → no plan.
do $$
declare j jsonb := '{}'; ag bigint := 1775637005921; C bigint := 990000000000402; PU bigint := 990000000000406;
 PE bigint := 990000000000407; d date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
 insert into customers (id, full_name, responsible_agent_id, created_at, updated_at) values (C, 'TEST POP', ag, now(), now());
 insert into purchases (id, customer_id, date, item, amount, status, payment_method, installment_tenure, pop_down_payment, agent_id, created_at, updated_at)
 values (PU, C, d, 'TEST Power Ring', 6500, 'COMPLETED', 'POP', 12, 500, ag, now(), now());
 j := j || jsonb_build_object('1_rows', (select count(*) from pop_installments where purchase_id = PU),
    '1_due', (select count(*) from pop_installments where purchase_id = PU and status = 'due'),
    '1_first', (select min(due_date) from pop_installments where purchase_id = PU),
    '1_amount', (select max(amount) from pop_installments where purchase_id = PU));
 update purchases set installment_tenure = 10, pop_monthly_amount = 600 where id = PU;
 j := j || jsonb_build_object('2_rebuilt', (select count(*) || 'x' || max(amount) from pop_installments where purchase_id = PU));
 update pop_installments set status = 'paid' where purchase_id = PU and seq = 1;
 update pop_installments set status = 'failed' where purchase_id = PU and seq = 2;
 update purchases set installment_tenure = 8 where id = PU;
 j := j || jsonb_build_object('3_not_rebuilt', (select count(*) from pop_installments where purchase_id = PU),
    '3_paid_date', (select paid_date from pop_installments where purchase_id = PU and seq = 1));
 j := j || jsonb_build_object('4_todo', (select json_agg(t.kind || ':' || t.why) from journey_todo_for(ag, 200) t where t.customer_id = C));
 perform set_config('request.jwt.claims', json_build_object('sub', '29df4985-fe38-4435-9a58-b0b9bffb13cc', 'role', 'authenticated')::text, true);
 j := j || jsonb_build_object('5_summary', (select row_to_json(s) from pop_summary() s));
 update purchases set status = 'CANCELLED' where id = PU;
 j := j || jsonb_build_object('6_after_cancel', (select json_agg(status order by seq) from pop_installments where purchase_id = PU));
 insert into purchases (id, customer_id, date, item, amount, status, payment_method, epp_months, agent_id, created_at, updated_at)
 values (PE, C, d, 'TEST EPP', 9000, 'COMPLETED', 'EPP', 12, ag, now(), now());
 j := j || jsonb_build_object('7_epp_rows', (select count(*) from pop_installments where purchase_id = PE));
 raise exception 'TEST %', j;
end $$;
