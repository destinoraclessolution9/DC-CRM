-- ci/sql/office-steps-scenario.sql — scenario for
-- migrations/2026-11-11_office_steps_phase2.sql. Run via the Management API
-- after the migration (or in the same request, before applying it: the RAISE at
-- the end rolls back the migration too). One DO block; every TEST row rolls back
-- and the result comes back in the error message.
-- Expect:
--  1 an item on the estimate: Step 3 = ready − 3, Step 4 = ready
--  2 office ready (yesterday): Step 3 = office + 2, Step 4 = office + 14
--  3 collected today: Step 3 due today
--  4 📲 told: Step 3 done ("auto: customer told"), Step 4 = told + 14
--  5 told undone: Step 3 open again, due today, note cleaned
--  6 handover: Step 3 + Step 4 done
--  7 to-do rows follow the step: 🏢 collect from office · 📲 tell · 🤝 told 14 days ·
--    nothing while told < 14 days · 📦 estimate unchanged
--  8 step push: one per agent (several → "📦 N delivery steps waiting"), only on
--    day 3 / 2 / 14 then weekly; a second run adds nothing
--  9 "📦 Ready in N days" skips items the office already released
do $$
declare j jsonb := '{}'; seller bigint := 1775637005921; other bigint := 1775472202840;
 d date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
 C bigint[] := array[990000000000801, 990000000000802, 990000000000803, 990000000000804, 990000000000805,
                     990000000000806, 990000000000807, 990000000000808, 990000000000809];
 P bigint[] := array[990000000000811, 990000000000812, 990000000000813, 990000000000814, 990000000000815,
                     990000000000816, 990000000000817, 990000000000818, 990000000000819];
 it bigint[] := array[]::bigint[]; x bigint; k int; v jsonb; n int;
begin
 for k in 1 .. 9 loop
   insert into customers (id, full_name, phone, responsible_agent_id, created_at, updated_at)
   values (C[k], 'TEST Step ' || k, '0123456789', case when k = 8 then other else seller end, now(), now());
   insert into purchases (id, customer_id, date, item, amount, status, payment_method, agent_id, invoice, created_at, updated_at)
   values (P[k], C[k], d - 120, 'TEST 财库 ' || k, 8000, 'COMPLETED', 'Cash', case when k = 8 then other else seller end, '99908' || k, now(), now());
   insert into delivery_items (customer_id, purchase_id, item_name, status, expected_ready_date)
   values (C[k], P[k], 'TEST 财库 ' || k, 'pending', d + 60) returning id into x;
   it := it || x;
 end loop;

 -- 1-6: item 9 walks every step
 j := j || jsonb_build_object('1_estimate', (select json_object_agg(stage_name, due_date - d) from journey_touchpoints
                                             where delivery_item_id = it[9] and stage_name in ('step03_ready', 'step04_collect')));
 update delivery_items set office_ready_date = d - 1, office_ready_place = 'lvl 20' where id = it[9];
 j := j || jsonb_build_object('2_office', (select json_object_agg(stage_name, due_date - d) from journey_touchpoints
                                           where delivery_item_id = it[9] and stage_name in ('step03_ready', 'step04_collect')));
 update delivery_items set collected_at = d, collected_by = seller where id = it[9];
 j := j || jsonb_build_object('3_collected', (select json_object_agg(stage_name, due_date - d) from journey_touchpoints
                                              where delivery_item_id = it[9] and stage_name in ('step03_ready', 'step04_collect')));
 update delivery_items set customer_told_at = now(), customer_told_by = seller where id = it[9];
 j := j || jsonb_build_object('4_told', (select json_object_agg(stage_name, json_build_object('status', status, 'due', due_date - d, 'by_ok', completed_by_id = seller, 'note', notes))
                                         from journey_touchpoints where delivery_item_id = it[9] and stage_name in ('step03_ready', 'step04_collect')));
 update delivery_items set customer_told_at = null, customer_told_by = null where id = it[9];
 j := j || jsonb_build_object('5_untold', (select json_object_agg(stage_name, json_build_object('status', status, 'due', due_date - d, 'note', notes))
                                           from journey_touchpoints where delivery_item_id = it[9] and stage_name in ('step03_ready', 'step04_collect')));
 update delivery_items set status = 'picked_up', handover_date = d, photos = '["delivery/test/x.jpg"]'::jsonb, handed_over_by = seller where id = it[9];
 j := j || jsonb_build_object('6_handover', (select json_object_agg(stage_name, status) from journey_touchpoints
                                             where delivery_item_id = it[9] and stage_name in ('step03_ready', 'step04_collect')));

 -- 7 + 8: one item per step
 update delivery_items set office_ready_date = d - 3, expected_ready_date = d + 10 where id = it[1];      -- 🏢 day 3 → push
 update delivery_items set office_ready_date = d - 5, collected_at = d - 2 where id = it[2];            -- 📲 day 2 → push
 update delivery_items set office_ready_date = d - 20, collected_at = d - 18,
                           customer_told_at = now() - interval '14 days' where id = it[3];               -- 🤝 day 14 → push
 update delivery_items set office_ready_date = d - 6, collected_at = d - 4,
                           customer_told_at = now() - interval '3 days' where id = it[4];                -- told 3 days: nothing
 update delivery_items set expected_ready_date = d + 3 where id = it[5];                                 -- 📦 estimate only
 update delivery_items set office_ready_date = d - 4 where id = it[6];                                   -- 🏢 day 4 → no push
 update delivery_items set office_ready_date = d - 10 where id = it[7];                                  -- 🏢 day 10 = 3 + 7 → push
 update delivery_items set office_ready_date = d - 3, collected_at = d - 2 where id = it[8];             -- other agent, 📲 day 2

 j := j || jsonb_build_object('7_todo', (select json_object_agg(r.name, json_build_object('icon', r.icon, 'kind', r.kind, 'why', r.why, 'due', r.due - d, 'ref_ok', r.ref_id = any (P)))
                                         from journey_todo_rows(seller, 1000, false) r where r.customer_id = any (C)));
 j := j || jsonb_build_object('7_rank_office_over_estimate',
     (select (select score from journey_todo_rows(seller, 1000, false) where customer_id = C[1])
           > (select score from journey_todo_rows(seller, 1000, false) where customer_id = C[5])));

 delete from notification_outbox where dedupe_key in ('office_step:' || seller || ':' || d, 'office_step:' || other || ':' || d);
 n := queue_office_step_reminders();
 j := j || jsonb_build_object('8_push', (select json_agg(json_build_object('to', case user_id when seller then 'seller' else 'other' end,
                                            'kind', kind, 'title', title, 'body', body, 'url', url) order by user_id)
                                         from notification_outbox where dedupe_key in ('office_step:' || seller || ':' || d, 'office_step:' || other || ':' || d)));
 j := j || jsonb_build_object('8_second_run', queue_office_step_reminders());

 delete from notification_outbox where dedupe_key like 'delivery_ready:%' and dedupe_key in
   (select 'delivery_ready:' || y || ':' || (select expected_ready_date from delivery_items where id = y) from unnest(it) y);
 perform queue_delivery_ready_reminders();
 j := j || jsonb_build_object('9_ready_push_items', (select json_agg(z.ix order by z.ix) from (
     select g.ix from generate_subscripts(it, 1) g(ix)
      where exists (select 1 from notification_outbox o where o.dedupe_key like 'delivery_ready:' || it[g.ix] || ':%')) z));

 raise exception 'SCENARIO %', j;
end $$;
