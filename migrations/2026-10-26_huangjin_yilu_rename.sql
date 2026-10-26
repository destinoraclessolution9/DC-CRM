-- 黄金一路, not 黄金大道 (owner, 2026-10-26): the Golden Road programme's
-- Chinese name is corrected everywhere — journey templates (names + messages),
-- every journey task title / message already created, and journey_gr_spawn,
-- which finds its template BY NAME (so the function and the template rename
-- go together in one transaction).
begin;

update public.journey_templates
   set name = replace(replace(name, '黄金大道', '黄金一路'), '黃金大道', '黄金一路'),
       message_template = replace(replace(message_template, '黄金大道', '黄金一路'), '黃金大道', '黄金一路')
 where name ~ '黄金大道|黃金大道' or message_template ~ '黄金大道|黃金大道';

update public.journey_touchpoints
   set title = replace(replace(title, '黄金大道', '黄金一路'), '黃金大道', '黄金一路'),
       message_template = replace(replace(message_template, '黄金大道', '黄金一路'), '黃金大道', '黄金一路')
 where title ~ '黄金大道|黃金大道' or message_template ~ '黄金大道|黃金大道';

CREATE OR REPLACE FUNCTION public.journey_gr_spawn(p_item bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    di record; pu record; prof record; v_cid bigint; v_pid bigint; v_agent bigint; v_uuid uuid;
    v_start date; v_base date; v_ready date; v_today date := public.journey_today(); v_done int; k int; v_due date; v_tpl bigint;
begin
    select * into di from public.delivery_items where id = p_item;
    if di.id is null or di.status <> 'pending' or di.expected_ready_date is null then return 0; end if;
    select * into pu from public.purchases where id = di.purchase_id;
    prof := public.journey_item_profile(coalesce(nullif(di.item_name, ''), pu.item));
    if prof.gr_sessions is null then return 0; end if;
    v_cid := public.journey_customer_of(di.customer_id, coalesce(di.prospect_id, pu.prospect_id));
    v_pid := coalesce(di.prospect_id, pu.prospect_id);
    -- one Golden Road per person at a time
    if exists (select 1 from public.journey_touchpoints t where t.seq is not null and t.stage_name = 'step05_golden_path'
                and t.status = 'pending' and ((v_cid is not null and t.customer_id = v_cid) or (v_cid is null and t.prospect_id = v_pid))) then
        return 0;
    end if;
    if exists (select 1 from public.journey_touchpoints t where t.delivery_item_id = p_item and t.seq is not null) then return 0; end if;
    v_agent := coalesce(pu.agent_id, (select responsible_agent_id from public.customers where id = v_cid));
    select auth_user_id into v_uuid from public.users where id = v_agent;
    select id into v_tpl from public.journey_templates where stage_name = 'step05_golden_path' and name = '🟣 Step 5 — 黄金一路' limit 1;
    v_start := coalesce(pu.date, di.created_at::date, v_today);
    v_ready := di.expected_ready_date;
    -- ready in under 2 weeks (or already late): no waiting period left
    if v_ready < v_today + 14 then return 0; end if;
    -- the welcome WA that opens Step 5 (before the sessions, which would
    -- otherwise count as "Step 5 already pending")
    if v_start >= v_today - 14 then
        perform public.journey_spawn(v_pid, v_cid, 'step05_golden_path', v_start, v_agent, null, pu.id, null, array['whatsapp_auto']);
    end if;
    select count(*) into v_done from public.activities a
     where a.activity_type = 'GR' and a.activity_date >= v_start
       and ((v_cid is not null and a.customer_id = v_cid) or (v_pid is not null and a.prospect_id = v_pid));
    v_done := least(v_done, prof.gr_sessions);
    v_base := greatest(v_start, v_today);
    for k in 1 .. prof.gr_sessions loop
        -- sessions still to do are spread evenly from today (or the sale) to the ready date
        v_due := case when k <= v_done then v_start
                      else v_base + ((v_ready - v_base) * (k - v_done) / (prof.gr_sessions - v_done + 1)) end;
        insert into public.journey_touchpoints
            (prospect_id, customer_id, template_id, stage_name, track, touchpoint_type, title, due_date, priority, status,
             assigned_to, assigned_to_id, product_track, follow_mode, purchase_id, delivery_item_id, seq, seq_total,
             auto_created, completed_at, notes)
        values (case when v_cid is null then v_pid end, v_cid, v_tpl, 'step05_golden_path', 'active', 'meeting',
                '🟣 Step 5 — 黄金一路 ' || k || '/' || prof.gr_sessions, greatest(v_due, v_today), 'high',
                case when k <= v_done then 'done' else 'pending' end,
                v_uuid, v_agent, 'all', 'active', pu.id, p_item, k, prof.gr_sessions, true,
                case when k <= v_done then now() end,
                case when k <= v_done then 'auto: GR already logged' end);
    end loop;
    return prof.gr_sessions;
exception when others then
    return 0;
end $function$;

commit;
