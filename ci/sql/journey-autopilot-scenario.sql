-- ci/sql/journey-autopilot-scenario.sql — end-to-end scenario for
-- migrations/2026-10-20_journey_autopilot.sql. Run it via the Management API
-- AFTER the migration: everything happens inside one DO block that ends with
-- RAISE EXCEPTION, so the whole transaction (TEST rows, pushes) rolls back and
-- the result comes back in the error message.
-- Expect: 1 post_cps WA+call · 2 CPS in to-do · 3 RSVP → invited_9star (post_cps skipped, no CPS to-do)
-- · 4 attended → post_9star · 5 sale → ring steps skipped + Step 1 · 6 ready = sale + 180d, GR 1–6/6, Step 3/4
-- · 7 GR logged → 1/6 done · 8 handover → Step 3/4 done + Step 6 (with 7-day call) · 9 Step 6 done → Step 7.
do $$
declare j jsonb := '{}'; ag bigint := 1775637005921; P bigint := 990000000000301; C bigint := 990000000000302;
 E bigint := 990000000000303; EA bigint := 990000000000304; EAT bigint := 990000000000305; PU bigint := 990000000000306;
 di bigint; d date := public.journey_today(); n int;
 st text;
begin
 insert into prospects (id, full_name, responsible_agent_id, cps_interest, status, created_at, updated_at)
 values (P, 'TEST Autopilot', ag, '个人改命 Power Ring', 'active', now(), now());
 insert into activities (id, activity_type, activity_date, prospect_id, lead_agent_id, activity_title, created_at, updated_at)
 values (P+10, 'CPS', d, P, ag, 'TEST CPS', now(), now());
 select string_agg(stage_name||':'||touchpoint_type||':'||status, ',' order by id) into st from journey_touchpoints where prospect_id=P;
 j := j || jsonb_build_object('1_after_cps', st);
 -- todo: CPS today is excluded (needs a day) → set CPS to 3 days ago
 update activities set activity_date = d-3 where id = P+10;
 j := j || jsonb_build_object('2_todo_cps', (select json_agg(t.kind||':'||t.why) from journey_todo_for(ag, 200) t where t.prospect_id=P));
 -- RSVP 九星 next week
 insert into events (id, title, date, created_at, updated_at) values (E, 'TEST 九星运命', d+7, now(), now());
 insert into activities (id, activity_type, activity_date, event_id, activity_title, created_at, updated_at) values (EAT, 'EVENT', d+7, E, 'TEST 九星运命', now(), now());
 insert into event_attendees (id, event_id, activity_id, entity_id, attendee_id, entity_name, attendee_type, attendance_status, attended, created_at)
 values (EA, E, EAT, P, P, 'TEST Autopilot', 'prospect', 'Registered', false, now());
 select string_agg(stage_name||':'||status, ',' order by id) into st from journey_touchpoints where prospect_id=P;
 j := j || jsonb_build_object('3_after_rsvp', st, '3b_todo_cps_gone', (select count(*) from journey_todo_for(ag, 200) t where t.prospect_id=P and t.kind='cps'));
 update event_attendees set attendance_status='Attended', attended=true where id=EA;
 select string_agg(stage_name||':'||status, ',' order by id) into st from journey_touchpoints where prospect_id=P;
 j := j || jsonb_build_object('4_after_attend', st);
 -- sale
 insert into customers (id, full_name, converted_from_prospect_id, responsible_agent_id, created_at, updated_at) values (C, 'TEST Autopilot', P, ag, now(), now());
 insert into purchases (id, customer_id, prospect_id, date, item, amount, status, agent_id, created_at, updated_at)
 values (PU, C, P, d, '六曜指环 Support Power Ring', 21990, 'Pending Delivery', ag, now(), now());
 select string_agg(coalesce(stage_name,'')||':'||status||':'||coalesce(customer_id::text,'p'), ',' order by id) into st from journey_touchpoints where prospect_id=P or customer_id=C;
 j := j || jsonb_build_object('5_after_sale', st);
 insert into delivery_items (customer_id, purchase_id, item_name, qty, status) values (C, PU, '六曜指环 Support Power Ring', 1, 'pending') returning id into di;
 j := j || jsonb_build_object('6_ready', (select expected_ready_date from delivery_items where id=di),
    '6_tps', (select json_agg(title||' @'||due_date||' '||status order by due_date, id) from journey_touchpoints where customer_id=C));
 insert into activities (id, activity_type, activity_date, customer_id, lead_agent_id, activity_title, created_at, updated_at)
 values (P+11, 'GR', d, C, ag, 'TEST GR', now(), now());
 j := j || jsonb_build_object('7_gr', (select json_build_object('done',count(*) filter (where status='done'),'tot',count(*)) from journey_touchpoints where customer_id=C and seq is not null));
 -- gr status as Kean (RLS context)
 perform set_config('request.jwt.claims', json_build_object('sub','29df4985-fe38-4435-9a58-b0b9bffb13cc','role','authenticated')::text, true);
 j := j || jsonb_build_object('7b_grstatus', (select json_agg(g) from journey_gr_status(P) g),
     '7c_daily', (select json_agg(t.icon||' '||t.name||' — '||t.why||' ['||t.score||']') from journey_daily_todo(5) t),
     '7d_funnel', (select json_agg(f) from journey_funnel(d-30, d) f),
     '7e_set', set_cps_next_step(P, 'later'));
 -- handover
 update delivery_items set status='picked_up', handover_date=d, photos='["delivery/test/x.jpg"]'::jsonb, handed_over_by=ag where id=di;
 j := j || jsonb_build_object('8_after_handover', (select json_agg(stage_name||':'||title||':'||status||' @'||due_date order by id) from journey_touchpoints where customer_id=C and seq is null));
 update journey_touchpoints set status='done' where customer_id=C and stage_name='step06_exchange';
 j := j || jsonb_build_object('9_chain', (select json_agg(stage_name||':'||status) from journey_touchpoints where customer_id=C and stage_name='step07_spread'));
 -- push queue functions run
 j := j || jsonb_build_object('10_push', queue_daily_todo_push(), '10b_cps', queue_cps_no_next_push(),
     '10c_body', (select body from notification_outbox where kind='daily_todo' and user_id=ag order by id desc limit 1));
 raise exception 'TEST %', j;
end $$;
