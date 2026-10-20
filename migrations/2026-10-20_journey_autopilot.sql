-- ═══════════════════════════════════════════════════════════════════════════
-- Ring Journey autopilot (2026-10-20) — items A–G of the journey audit.
--
-- The journey system (journey_templates / journey_touchpoints) only ran when
-- someone pressed "Spawn", or when the journey chunk happened to be loaded at
-- the moment an activity was saved (it usually isn't), and its event rules
-- read an `event_category` column that does not exist. So 12 touchpoints were
-- ever created. This moves the automation into the database, where it runs on
-- every device:
--
--   A  CPS can't end with nothing next — prospects.cps_next_step (set from the
--      prompt after a CPS save) + "CPS with no 2nd meeting" in the daily to-do
--      and a Monday push.
--   B  Power Ring track starts by itself when ring potential is noted, and
--      moves forward when the person registers for / attends 九星 → 改命 →
--      博物馆 → 汇集 → FSA.
--   C  Sale → Step 1 order confirmed · ready date = sale date + product lead
--      time (Power Ring ≈ 6 months) · Step 3 "ready to collect" WA · Step 4
--      collection (done only by the photo handover on the delivery item).
--   D  Golden Road ×6 (products.golden_road_sessions) spread evenly from the
--      sale to the ready date; logging a GR activity ticks one off.
--   E  Photo handover → Step 6 onward + a 7-day "how's the ring" call;
--      Steps 6 → 7 → 8 → 9 chain on as each one is finished.
--   F  journey_daily_todo(): one top-5 list per agent, ranked money × urgency,
--      + an 08:30 push.
--   G  journey_funnel(): CPS → met again → potential → event → signed →
--      collected → GR 6/6 → referral, per agent.
--
-- Every trigger swallows its own errors: a journey hiccup never blocks saving
-- an activity, a sale or a delivery item.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Columns ──────────────────────────────────────────────────────────────
alter table public.prospects
    add column if not exists cps_next_step    text,
    add column if not exists cps_next_step_at timestamptz;

alter table public.products
    add column if not exists golden_road_sessions integer;

alter table public.journey_touchpoints
    add column if not exists purchase_id         bigint,
    add column if not exists delivery_item_id    bigint,
    add column if not exists seq                 integer,
    add column if not exists seq_total           integer,
    add column if not exists auto_created        boolean not null default false,
    add column if not exists done_by_activity_id bigint;

create index if not exists jt_pending_pros on public.journey_touchpoints (prospect_id, stage_name) where status = 'pending';
create index if not exists jt_pending_cust on public.journey_touchpoints (customer_id, stage_name) where status = 'pending';
create index if not exists jt_item on public.journey_touchpoints (delivery_item_id) where delivery_item_id is not null;

-- Owner (2026-10-19): rings are custom-made, ~6 months. 6 Golden Road sessions.
update public.products set delivery_lead_time = 'About 6 months'
 where subcategory = 'Power Ring' and coalesce(delivery_lead_time, '') = '';
update public.products set golden_road_sessions = 6
 where subcategory = 'Power Ring' and golden_road_sessions is null;

-- Customer touchpoints were visible only to their assignee's auth uuid.
drop policy if exists journey_touchpoints_sel on public.journey_touchpoints;
create policy journey_touchpoints_sel on public.journey_touchpoints for select to authenticated using (
    coalesce(public.current_user_level(), 99) <= 2 or assigned_to = auth.uid() or completed_by = auth.uid()
    or assigned_to_id = public.current_user_row_id()
    or public.prospect_is_visible(prospect_id) or public.customer_is_visible(customer_id));
drop policy if exists journey_touchpoints_upd on public.journey_touchpoints;
create policy journey_touchpoints_upd on public.journey_touchpoints for update to authenticated using (
    coalesce(public.current_user_level(), 99) <= 2 or assigned_to = auth.uid()
    or assigned_to_id = public.current_user_row_id()
    or public.prospect_is_visible(prospect_id) or public.customer_is_visible(customer_id)) with check (true);

-- ── 1. New templates (Steps 1, 3, 4, Golden Road session, 7-day check) ──────
insert into public.journey_templates (name, track, stage_name, days_offset, touchpoint_type, message_template, assigned_to_role, priority, is_active, sort_order, product_track, follow_mode)
select v.* from (values
  ('✅ Step 1 — 订单确认WA', 'active', 'step01_order', 0, 'whatsapp_auto',
   '嗨 {name}！感谢您的信任 🙏 您的订单已确认。我们会定期和您更新制作进度，等待期间我会陪您走《黄金大道》，让改变从今天开始。', 'system', 'high', true, 1900, 'all', 'active'),
  ('🟣 Step 5 — 黄金大道', 'active', 'step05_golden_path', 0, 'meeting',
   null, 'agent', 'high', false, 2005, 'all', 'active'),
  ('📦 Step 3 — 准备领取通知WA', 'active', 'step03_ready', 0, 'whatsapp_auto',
   '嗨 {name}！好消息 🎉 您的宝物快准备好了。我们约个时间来领取吧，当天会帮您拍照留念！', 'system', 'high', true, 1950, 'all', 'active'),
  ('🤝 Step 4 — 领取 + 拍照', 'active', 'step04_collect', 0, 'task',
   null, 'agent', 'high', true, 1960, 'all', 'active'),
  ('💬 Step 6 — 领取7天关怀', 'active', 'step06_exchange', 7, 'call',
   null, 'agent', 'high', true, 2095, 'all', 'active')
) v(name, track, stage_name, days_offset, touchpoint_type, message_template, assigned_to_role, priority, is_active, sort_order, product_track, follow_mode)
where not exists (select 1 from public.journey_templates t where t.stage_name = v.stage_name and t.name = v.name);
-- (the Golden Road session template is inactive on purpose: sessions are
--  generated with their own n/6 numbering, never spawned as a stage set)

-- The client rules engine spawned the same stages when the journey chunk was
-- loaded — turn those rules off so nothing is created twice. Role upgrades and
-- the non-ring tracks keep running client-side.
update public.conditional_rules set is_active = false
 where id in (8, 15, 16, 17, 18, 19, 37, 39) and is_active;

-- ── 2. Helpers ──────────────────────────────────────────────────────────────
create or replace function public.journey_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kuala_Lumpur')::date $$;

create or replace function public.journey_is_ring(p_text text) returns boolean
language sql immutable as $$
    select coalesce(p_text, '') ~* '(power\s*ring|指环|戒指|改命戒|\mring\M|\mpr\s?\d)'
$$;

-- Lead time text ("At least 9 months", "About 6 months", "8 weeks") → days.
create or replace function public.journey_lead_days(p_text text) returns integer
language sql immutable as $$
    select case
        when p_text ~* '(\d+)\s*(month|个月|月)' then (substring(p_text from '(\d+)\s*(?:month|个月|月)'))::int * 30
        when p_text ~* '(\d+)\s*(week|周|星期)'  then (substring(p_text from '(\d+)\s*(?:week|周|星期)'))::int * 7
        when p_text ~* '(\d+)\s*(day|天)'        then (substring(p_text from '(\d+)\s*(?:day|天)'))::int
        else null end
$$;

-- Lead days + Golden Road sessions for a sold item text.
create or replace function public.journey_item_profile(p_item text, out lead_days integer, out gr_sessions integer, out is_ring boolean)
language plpgsql stable security definer set search_path = public as $$
begin
    is_ring := public.journey_is_ring(p_item);
    select public.journey_lead_days(pr.delivery_lead_time), pr.golden_road_sessions
      into lead_days, gr_sessions
      from public.products pr
     where coalesce(pr.is_active, true) and public.pipeline_name_match(p_item, pr.name)
     order by length(pr.name) desc limit 1;
    if is_ring and (lead_days is null or gr_sessions is null) then
        select coalesce(lead_days, max(public.journey_lead_days(pr.delivery_lead_time))),
               coalesce(gr_sessions, max(pr.golden_road_sessions))
          into lead_days, gr_sessions
          from public.products pr where pr.subcategory = 'Power Ring';
    end if;
    if gr_sessions is not null and gr_sessions <= 0 then gr_sessions := null; end if;
end $$;

-- Spawn one stage's templates for a person (prospect OR customer). Skips when
-- that stage already has a pending touchpoint (per delivery item when given).
-- Due dates never land in the past.
create or replace function public.journey_spawn(
    p_pid bigint, p_cid bigint, p_stage text, p_start date, p_agent bigint,
    p_track text default null, p_purchase bigint default null, p_item bigint default null,
    p_types text[] default null) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n int; v_uuid uuid; v_today date := public.journey_today();
begin
    if p_pid is null and p_cid is null then return 0; end if;
    if exists (select 1 from public.journey_touchpoints t
                where t.status = 'pending' and t.stage_name = p_stage
                  and ((p_cid is not null and t.customer_id = p_cid) or (p_cid is null and t.prospect_id = p_pid))
                  and (p_item is null or t.delivery_item_id = p_item)) then
        return 0;
    end if;
    select auth_user_id into v_uuid from public.users where id = p_agent;
    insert into public.journey_touchpoints
        (prospect_id, customer_id, template_id, stage_name, track, touchpoint_type, message_template, title,
         due_date, priority, status, assigned_to, assigned_to_id, escalate_after_days, product_track, follow_mode,
         purchase_id, delivery_item_id, auto_created)
    select case when p_cid is null then p_pid end, p_cid, t.id, t.stage_name, coalesce(t.track, 'active'),
           t.touchpoint_type, t.message_template, t.name,
           greatest(coalesce(p_start, v_today) + coalesce(t.days_offset, 0), v_today),
           t.priority, 'pending', v_uuid, p_agent, t.escalate_after_days,
           coalesce(p_track, t.product_track), coalesce(t.follow_mode, 'active'),
           p_purchase, p_item, true
      from public.journey_templates t
     where t.is_active and t.stage_name = p_stage
       and (p_track is null or t.product_track is null or t.product_track in (p_track, 'all'))
       and (p_types is null or t.touchpoint_type = any (p_types))
     order by t.sort_order;
    get diagnostics v_n = row_count;
    if v_n > 0 then
        insert into public.journey_stage_log (entity_type, entity_id, to_stage, notes)
        values (case when p_cid is null then 'prospect' else 'customer' end, coalesce(p_cid, p_pid), p_stage, 'Auto: journey autopilot');
    end if;
    return v_n;
end $$;

-- ── 3. B · Power Ring track ─────────────────────────────────────────────────
-- Stage index on the ring track; the furthest milestone reached wins.
create or replace function public.journey_pr_index(p_stage text) returns integer
language sql immutable as $$
    select array_position(array['pr_post_cps','pr_invited_9star','pr_post_9star','pr_invited_sharing','pr_post_sharing',
                                'pr_invited_museum','pr_post_museum','pr_invited_huiji','pr_post_huiji',
                                'pr_fsa_scheduled','pr_decision'], p_stage)
$$;

-- Event title → ring-track milestone key.
create or replace function public.journey_event_kind(p_title text) returns text
language sql immutable as $$
    select case
        when p_title ~ '代理会议' then null
        when p_title ~ '九星' then '9star'
        when p_title ~ '汇[集聚]|匯[集聚]' then 'huiji'
        when p_title ~* '博物馆|博物館|museum' then 'museum'
        when p_title ~ '改命' then 'sharing'
        else null end
$$;

create or replace function public.journey_pr_sync(p_pid bigint) returns text
language plpgsql security definer set search_path = public as $$
declare
    p record; v_today date := public.journey_today();
    v_ring boolean; v_target text; v_target_date date; v_cur int; v_agent bigint;
    r record;
begin
    select * into p from public.prospects where id = p_pid;
    if p.id is null then return null; end if;
    if coalesce(p.status, '') in ('converted', 'lost') or coalesce(p.unable_to_serve, false)
       or coalesce(p.manual_grade, '') = 'F' or coalesce(p.cps_next_step, '') = 'not_interested' then
        return null;
    end if;
    -- already bought → the post-sale journey owns this person
    if exists (select 1 from public.purchases pu where pu.prospect_id = p_pid and pu.amount > 0
                and coalesce(pu.status, '') !~* 'cancel|refund|void') then return null; end if;

    v_ring := public.journey_is_ring(p.cps_interest) or coalesce(p.cps_interest, '') ~ '个人改命'
           or exists (select 1 from jsonb_array_elements(coalesce(p.open_potential_detail -> 'items', '[]'::jsonb)) i
                       where public.journey_is_ring(i ->> 'label'))
           or exists (select 1 from public.journey_touchpoints t where t.prospect_id = p_pid and t.product_track = 'pr');
    if not v_ring then return null; end if;
    -- only people we're actually working (recent contact or money on the table)
    if coalesce(p.last_activity_date, p.created_at::date) < v_today - 183 and coalesce(p.open_potential_rm, 0) <= 0
       and not exists (select 1 from public.journey_touchpoints t where t.prospect_id = p_pid and t.product_track = 'pr') then
        return null;
    end if;

    v_target := 'pr_post_cps';
    select coalesce(max(a.activity_date), v_today) into v_target_date
      from public.activities a where a.prospect_id = p_pid and a.activity_type = 'CPS';

    -- events: attended → post stage; registered for an upcoming one → invited stage
    for r in
        select public.journey_event_kind(e.title) k,
               coalesce(ac.activity_date, nullif(e.date::text, '')::date) d,
               (ea.attended or ea.attendance_status = 'Attended') att
          from public.event_attendees ea
          join public.events e on e.id = ea.event_id
          left join public.activities ac on ac.id = ea.activity_id
         where ea.attendee_type = 'prospect' and ea.entity_id = p_pid
           and coalesce(ea.attendance_status, '') <> 'No Show'
    loop
        continue when r.k is null;
        if r.att then
            if public.journey_pr_index('pr_post_' || r.k) > public.journey_pr_index(v_target) then
                v_target := 'pr_post_' || r.k; v_target_date := r.d;
            end if;
        elsif r.d >= v_today then
            if public.journey_pr_index('pr_invited_' || r.k) > public.journey_pr_index(v_target) then
                v_target := 'pr_invited_' || r.k; v_target_date := v_today;
            end if;
        end if;
    end loop;
    -- FSA: booked → fsa_scheduled, done → decision
    if exists (select 1 from public.activities a where a.prospect_id = p_pid and a.activity_type = 'FSA' and a.activity_date <= v_today) then
        v_target := 'pr_decision';
        select max(a.activity_date) into v_target_date from public.activities a
         where a.prospect_id = p_pid and a.activity_type = 'FSA' and a.activity_date <= v_today;
    elsif exists (select 1 from public.activities a where a.prospect_id = p_pid and a.activity_type = 'FSA' and a.activity_date > v_today)
          and public.journey_pr_index('pr_fsa_scheduled') > public.journey_pr_index(v_target) then
        v_target := 'pr_fsa_scheduled'; v_target_date := v_today;
    end if;

    select max(public.journey_pr_index(t.stage_name)) into v_cur
      from public.journey_touchpoints t where t.prospect_id = p_pid and t.product_track = 'pr';
    if v_cur is not null and public.journey_pr_index(v_target) <= v_cur then return v_target; end if;

    -- moved on: earlier ring-track steps are no longer needed
    update public.journey_touchpoints set status = 'skipped', notes = coalesce(notes || ' · ', '') || 'auto: moved on to ' || v_target
     where prospect_id = p_pid and product_track = 'pr' and status = 'pending';
    v_agent := coalesce(p.responsible_agent_id, p.cps_agent_id);
    -- a step reached more than 2 weeks ago: skip its "thank you / how was it"
    -- WhatsApps, keep the calls and tasks
    perform public.journey_spawn(p_pid, null, v_target, v_target_date, v_agent, 'pr', null, null,
        case when v_target_date < v_today - 14 then array['call', 'task', 'meeting'] end);
    return v_target;
exception when others then
    return null;
end $$;

-- ── 4. C/D/E · after the sale ───────────────────────────────────────────────
create or replace function public.journey_customer_of(p_cid bigint, p_pid bigint) returns bigint
language sql stable security definer set search_path = public as $$
    select coalesce(p_cid, (select c.id from public.customers c where c.converted_from_prospect_id = p_pid order by c.id limit 1))
$$;

-- Step 1 on every real sale; ring-track steps still open are closed.
create or replace function public.journey_sale_sync(p_purchase bigint) returns integer
language plpgsql security definer set search_path = public as $$
declare pu record; v_cid bigint; v_agent bigint; v_n int := 0; prof record;
begin
    select * into pu from public.purchases where id = p_purchase;
    if pu.id is null or coalesce(pu.amount, 0) <= 0 or coalesce(pu.status, '') ~* 'cancel|refund|void'
       or coalesce(pu.item, '') ~* 'imported|pre-system' then return 0; end if;
    v_cid := public.journey_customer_of(pu.customer_id, pu.prospect_id);
    v_agent := coalesce(pu.agent_id, (select responsible_agent_id from public.customers where id = v_cid));
    if pu.prospect_id is not null then
        update public.journey_touchpoints set status = 'skipped', notes = coalesce(notes || ' · ', '') || 'auto: purchased'
         where prospect_id = pu.prospect_id and status = 'pending' and coalesce(product_track, '') not in ('all', '')
           and stage_name !~ '^step';
    end if;
    v_n := public.journey_spawn(pu.prospect_id, v_cid, 'step01_order', pu.date, v_agent, null, pu.id);
    prof := public.journey_item_profile(pu.item);
    if prof.gr_sessions is null then
        -- no waiting period (not a made-to-order ring): the usual Step 5 set
        v_n := v_n + public.journey_spawn(pu.prospect_id, v_cid, 'step05_golden_path', pu.date, v_agent, null, pu.id);
    end if;
    return v_n;
exception when others then
    return 0;
end $$;

-- Golden Road n/N spread evenly between the sale and the ready date. GR
-- activities already logged since the sale count as the first sessions done.
create or replace function public.journey_gr_spawn(p_item bigint) returns integer
language plpgsql security definer set search_path = public as $$
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
    select id into v_tpl from public.journey_templates where stage_name = 'step05_golden_path' and name = '🟣 Step 5 — 黄金大道' limit 1;
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
                '🟣 Step 5 — 黄金大道 ' || k || '/' || prof.gr_sessions, greatest(v_due, v_today), 'high',
                case when k <= v_done then 'done' else 'pending' end,
                v_uuid, v_agent, 'all', 'active', pu.id, p_item, k, prof.gr_sessions, true,
                case when k <= v_done then now() end,
                case when k <= v_done then 'auto: GR already logged' end);
    end loop;
    return prof.gr_sessions;
exception when others then
    return 0;
end $$;

-- Step 3 / Step 4 per delivery item, kept on the item's ready date.
create or replace function public.journey_item_sync(p_item bigint) returns void
language plpgsql security definer set search_path = public as $$
declare di record; pu record; v_cid bigint; v_pid bigint; v_agent bigint; v_today date := public.journey_today();
begin
    select * into di from public.delivery_items where id = p_item;
    if di.id is null then return; end if;
    select * into pu from public.purchases where id = di.purchase_id;
    v_pid := coalesce(di.prospect_id, pu.prospect_id);
    v_cid := public.journey_customer_of(di.customer_id, v_pid);
    v_agent := coalesce(pu.agent_id, (select responsible_agent_id from public.customers where id = v_cid));

    if di.status = 'pending' then
        if di.expected_ready_date is null then return; end if;
        if not exists (select 1 from public.journey_touchpoints t where t.delivery_item_id = p_item and t.stage_name = 'step03_ready') then
            perform public.journey_spawn(v_pid, v_cid, 'step03_ready', di.expected_ready_date - 3, v_agent, null, pu.id, p_item);
        end if;
        if not exists (select 1 from public.journey_touchpoints t where t.delivery_item_id = p_item and t.stage_name = 'step04_collect') then
            perform public.journey_spawn(v_pid, v_cid, 'step04_collect', di.expected_ready_date, v_agent, null, pu.id, p_item);
        end if;
        update public.journey_touchpoints
           set due_date = greatest(di.expected_ready_date - case when stage_name = 'step03_ready' then 3 else 0 end, v_today),
               title = title
         where delivery_item_id = p_item and status = 'pending' and stage_name in ('step03_ready', 'step04_collect')
           and due_date is distinct from greatest(di.expected_ready_date - case when stage_name = 'step03_ready' then 3 else 0 end, v_today);
        perform public.journey_gr_spawn(p_item);
    else
        -- handed over with photo (the table's CHECK guarantees date + photo)
        update public.journey_touchpoints
           set status = 'done', completed_at = now(), completed_by_id = di.handed_over_by,
               notes = coalesce(notes || ' · ', '') || 'auto: handed over ' || di.handover_date
         where delivery_item_id = p_item and status = 'pending' and stage_name in ('step03_ready', 'step04_collect');
        -- E: everything on this order collected → after-collection journey
        if not exists (select 1 from public.delivery_items x where x.purchase_id is not distinct from di.purchase_id
                        and coalesce(x.customer_id, 0) = coalesce(di.customer_id, 0) and x.status = 'pending') then
            perform public.journey_spawn(v_pid, v_cid, 'step06_exchange', coalesce(di.handover_date, v_today), v_agent, null, pu.id);
        end if;
    end if;
exception when others then
    return;
end $$;

-- ready date = sale date + lead time when nobody typed one
create or replace function public.journey_item_ready_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_date date; v_item text; prof record;
begin
    if new.status = 'pending' and new.expected_ready_date is null then
        select p.date, coalesce(nullif(new.item_name, ''), p.item) into v_date, v_item
          from public.purchases p where p.id = new.purchase_id;
        prof := public.journey_item_profile(coalesce(v_item, new.item_name));
        if prof.lead_days is not null then
            new.expected_ready_date := coalesce(v_date, (now() at time zone 'Asia/Kuala_Lumpur')::date) + prof.lead_days;
        end if;
    end if;
    return new;
exception when others then
    return new;
end $$;
drop trigger if exists trg_journey_item_ready on public.delivery_items;
create trigger trg_journey_item_ready before insert or update of expected_ready_date, item_name, status on public.delivery_items
    for each row execute function public.journey_item_ready_trg();

create or replace function public.journey_item_after_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    perform public.journey_item_sync(new.id);
    return null;
exception when others then
    return null;
end $$;
drop trigger if exists trg_journey_item_after on public.delivery_items;
create trigger trg_journey_item_after after insert or update of expected_ready_date, status on public.delivery_items
    for each row execute function public.journey_item_after_trg();

create or replace function public.journey_purchase_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    perform public.journey_sale_sync(new.id);
    return null;
exception when others then
    return null;
end $$;
drop trigger if exists trg_journey_purchase on public.purchases;
create trigger trg_journey_purchase after insert on public.purchases
    for each row execute function public.journey_purchase_trg();

-- D: a GR activity ticks off the next Golden Road session. B: any activity
-- (CPS, FSA…) can move the ring track on.
create or replace function public.journey_activity_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cid bigint; v_tp bigint;
begin
    if tg_op = 'INSERT' and new.activity_type = 'GR' then
        v_cid := public.journey_customer_of(new.customer_id, new.prospect_id);
        select t.id into v_tp from public.journey_touchpoints t
         where t.status = 'pending' and t.stage_name = 'step05_golden_path' and t.seq is not null
           and ((v_cid is not null and t.customer_id = v_cid) or (new.prospect_id is not null and t.prospect_id = new.prospect_id))
         order by t.seq limit 1;
        if v_tp is not null then
            update public.journey_touchpoints
               set status = 'done', completed_at = now(), completed_by_id = new.lead_agent_id, done_by_activity_id = new.id,
                   notes = coalesce(notes || ' · ', '') || 'auto: GR logged ' || new.activity_date
             where id = v_tp;
        end if;
    end if;
    if new.prospect_id is not null and new.activity_type in ('CPS', 'FTF', 'FSA', 'EVENT', 'EVENT_CLOSING', 'CALL', 'SITE') then
        perform public.journey_pr_sync(new.prospect_id);
    end if;
    return null;
exception when others then
    return null;
end $$;
drop trigger if exists trg_journey_activity on public.activities;
create trigger trg_journey_activity after insert or update of activity_type, activity_date, prospect_id, opportunity_potential on public.activities
    for each row execute function public.journey_activity_trg();

create or replace function public.journey_attendee_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.attendee_type = 'prospect' and new.entity_id is not null then
        perform public.journey_pr_sync(new.entity_id);
    end if;
    return null;
exception when others then
    return null;
end $$;
drop trigger if exists trg_journey_attendee on public.event_attendees;
create trigger trg_journey_attendee after insert or update of attendance_status, attended on public.event_attendees
    for each row execute function public.journey_attendee_trg();

create or replace function public.journey_prospect_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    perform public.journey_pr_sync(new.id);
    return null;
exception when others then
    return null;
end $$;
drop trigger if exists trg_journey_prospect on public.prospects;
create trigger trg_journey_prospect after update of open_potential_detail, cps_interest, cps_next_step on public.prospects
    for each row when (old.open_potential_detail is distinct from new.open_potential_detail
                       or old.cps_interest is distinct from new.cps_interest
                       or old.cps_next_step is distinct from new.cps_next_step)
    execute function public.journey_prospect_trg();

-- E (chain): Step 6 → 7 → 8 → 9 as each stage is finished.
create or replace function public.journey_chain_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_next text;
begin
    if new.status in ('done', 'skipped') and old.status = 'pending' then
        v_next := case new.stage_name when 'step06_exchange' then 'step07_spread'
                                      when 'step07_spread' then 'step08_testimony'
                                      when 'step08_testimony' then 'step09_intro' end;
        if v_next is not null and not exists (
            select 1 from public.journey_touchpoints t where t.status = 'pending' and t.stage_name = new.stage_name
               and t.customer_id is not distinct from new.customer_id and t.prospect_id is not distinct from new.prospect_id) then
            perform public.journey_spawn(new.prospect_id, new.customer_id, v_next, public.journey_today(), new.assigned_to_id, null, new.purchase_id);
        end if;
    end if;
    return null;
exception when others then
    return null;
end $$;
drop trigger if exists trg_journey_chain on public.journey_touchpoints;
create trigger trg_journey_chain after update of status on public.journey_touchpoints
    for each row execute function public.journey_chain_trg();

-- ── 5. Golden Road status for the profile line (🟣 2/6 · PR6 ready ~15 Dec) ──
create or replace function public.journey_gr_status(p_pid bigint)
returns table (done integer, total integer, next_due date, item text, ready_date date, collected boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_cid bigint;
begin
    if not public.prospect_is_visible(p_pid) then
        v_cid := public.journey_customer_of(null, p_pid);
        if v_cid is null or not public.customer_is_visible(v_cid) then return; end if;
    end if;
    v_cid := public.journey_customer_of(null, p_pid);
    return query
    select count(*) filter (where t.status = 'done')::int, max(t.seq_total)::int,
           min(t.due_date) filter (where t.status = 'pending'),
           max(di.item_name), max(di.expected_ready_date),
           bool_and(di.status <> 'pending')
      from public.journey_touchpoints t
      left join public.delivery_items di on di.id = t.delivery_item_id
     where t.seq is not null and t.stage_name = 'step05_golden_path'
       and ((v_cid is not null and t.customer_id = v_cid) or t.prospect_id = p_pid)
       and t.delivery_item_id = (select t2.delivery_item_id from public.journey_touchpoints t2
                                  where t2.seq is not null and t2.stage_name = 'step05_golden_path'
                                    and ((v_cid is not null and t2.customer_id = v_cid) or t2.prospect_id = p_pid)
                                  order by t2.created_at desc limit 1)
    having count(*) > 0;
end $$;
revoke all on function public.journey_gr_status(bigint) from public, anon;
grant execute on function public.journey_gr_status(bigint) to authenticated;

-- ── 6. F · one daily to-do, ranked money × urgency ──────────────────────────
drop function if exists public.journey_daily_todo(integer);
drop function if exists public.journey_todo_for(bigint, integer);
create or replace function public.journey_todo_for(p_uid bigint, p_limit integer default 5)
returns table (kind text, icon text, prospect_id bigint, customer_id bigint, name text, why text, rm numeric, due date, score numeric, ref_id bigint)
language sql stable security definer set search_path = public as $$
with t as (select public.journey_today() d),
c as (   -- ① collections: ready ≤ 7 days, not handed over
    select 'collect'::text kind, '📦'::text icon, cu.converted_from_prospect_id pid, cu.id cid, cu.full_name nm,
           case when di.expected_ready_date < t.d then 'Collect ' || left(di.item_name, 30) || ' · ready since ' || to_char(di.expected_ready_date, 'FMDD Mon')
                else 'Ready ' || to_char(di.expected_ready_date, 'FMDD Mon') || ' · book the collection + photo' end why,
           coalesce(pu.amount, 10000) rm, di.expected_ready_date due,
           greatest(coalesce(pu.amount, 10000), 3000) * case when di.expected_ready_date < t.d then 3 else 2 end
             * (1 + least(greatest(t.d - di.expected_ready_date, 0), 30) / 30.0) sc, di.purchase_id ref
      from public.delivery_items di cross join t
      join public.customers cu on cu.id = di.customer_id
      left join public.purchases pu on pu.id = di.purchase_id
     where di.status = 'pending' and di.expected_ready_date <= t.d + 7
       and di.expected_ready_date >= t.d - 120
       and coalesce(pu.agent_id, cu.responsible_agent_id) = p_uid
),
g as (   -- ② Golden Road session due
    select 'gr', '🟣', coalesce(tp.prospect_id, cu.converted_from_prospect_id), tp.customer_id, coalesce(cu.full_name, pr.full_name),
           'Golden Road ' || tp.seq || '/' || tp.seq_total || case when tp.due_date < t.d then ' · overdue' else ' · due ' || to_char(tp.due_date, 'FMDD Mon') end,
           coalesce(pu.amount, 10000), tp.due_date,
           greatest(coalesce(pu.amount, 10000), 3000) * 2 * (1 + least(greatest(t.d - tp.due_date, 0), 30) / 30.0), tp.purchase_id
      from public.journey_touchpoints tp cross join t
      left join public.customers cu on cu.id = tp.customer_id
      left join public.prospects pr on pr.id = tp.prospect_id
      left join public.purchases pu on pu.id = tp.purchase_id
     where tp.status = 'pending' and tp.seq is not null and tp.assigned_to_id = p_uid and tp.due_date <= t.d + 3
       and coalesce(tp.snooze_until, t.d) <= t.d
),
cps as ( -- ③ CPS with no 2nd meeting (A)
    select 'cps', '🆕', p.id, null::bigint, p.full_name,
           'CPS ' || to_char(x.d, 'FMDD Mon') || ' · no 2nd meeting booked',
           coalesce(nullif(p.open_potential_rm, 0), 5000), x.d,
           greatest(coalesce(p.open_potential_rm, 0), 5000) * 1.5 * case when t.d - x.d <= 14 then 1.2 else 0.8 end, null::bigint
      from public.prospects p cross join t
      cross join lateral (select max(a.activity_date) d from public.activities a where a.prospect_id = p.id and a.activity_type = 'CPS') x
     where p.responsible_agent_id = p_uid and x.d between t.d - 30 and t.d - 1
       and coalesce(p.status, '') not in ('converted', 'lost') and not coalesce(p.unable_to_serve, false)
       and coalesce(p.manual_grade, '') <> 'F' and coalesce(p.cps_next_step, '') <> 'not_interested'
       and not exists (select 1 from public.activities a where a.prospect_id = p.id and a.activity_date > x.d
                         and a.activity_type in ('CPS', 'FTF', 'FSA', 'SITE', 'GR', 'EVENT', 'EVENT_CLOSING'))
       and not exists (select 1 from public.event_attendees ea where ea.attendee_type = 'prospect' and ea.entity_id = p.id
                         and ea.created_at::date >= x.d)
),
hot as ( -- ④ Commit / Audit / Hot with nothing booked
    select 'book', case p.potential_tier when 'commit' then '🟢' when 'audit' then '🩺' else '🔥' end, p.id, null::bigint, p.full_name,
           initcap(p.potential_tier) || ' · RM' || round(p.open_potential_rm / 1000) || 'k · nothing booked'
             || coalesce(' · met ' || to_char(p.potential_last_met, 'FMDD Mon'), ''),
           p.open_potential_rm, p.potential_last_met,
           p.open_potential_rm * case p.potential_tier when 'commit' then 3 when 'audit' then 2 else 1.5 end
             * (1 + least(coalesce(t.d - p.potential_last_met, 60), 60) / 60.0), null::bigint
      from public.prospects p cross join t
     where p.responsible_agent_id = p_uid and p.potential_tier in ('commit', 'audit', 'hot')
       and p.potential_next_booked is null and p.open_potential_rm > 0
),
tp as (  -- ⑤ any other journey step due today or overdue
    select 'touch', '🧭', coalesce(j.prospect_id, cu.converted_from_prospect_id), j.customer_id, coalesce(cu.full_name, pr.full_name),
           regexp_replace(j.title, '^\S+\s+', '') || case when j.due_date < t.d then ' · overdue' else '' end,
           coalesce(nullif(pr.open_potential_rm, 0), 3000), j.due_date,
           greatest(coalesce(pr.open_potential_rm, 0), 3000) * case when j.priority = 'high' then 1.2 else 1 end
             * (1 + least(greatest(t.d - j.due_date, 0), 30) / 30.0), j.id
      from public.journey_touchpoints j cross join t
      left join public.customers cu on cu.id = j.customer_id
      left join public.prospects pr on pr.id = j.prospect_id
     where j.status = 'pending' and j.seq is null and j.assigned_to_id = p_uid and j.due_date <= t.d
       and j.due_date >= t.d - 60 and coalesce(j.snooze_until, t.d) <= t.d
),
allx as (select * from c union all select * from g union all select * from cps union all select * from hot union all select * from tp),
best as (
    select distinct on (coalesce('c' || cid::text, 'p' || pid::text)) * from allx
     where nm is not null
     order by coalesce('c' || cid::text, 'p' || pid::text), sc desc
)
select kind, icon, pid, cid, nm, why, rm, due, round(sc), ref from best order by sc desc limit greatest(coalesce(p_limit, 5), 1)
$$;
revoke all on function public.journey_todo_for(bigint, integer) from public, anon, authenticated;

create or replace function public.journey_daily_todo(p_limit integer default 5)
returns table (kind text, icon text, prospect_id bigint, customer_id bigint, name text, why text, rm numeric, due date, score numeric, ref_id bigint)
language sql stable security definer set search_path = public as $$
    select * from public.journey_todo_for(public.current_user_row_id(), p_limit)
$$;
revoke all on function public.journey_daily_todo(integer) from public, anon;
grant execute on function public.journey_daily_todo(integer) to authenticated;

create or replace function public.queue_daily_todo_push() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_today date := public.journey_today(); v_n int;
begin
    insert into public.notification_outbox (user_id, kind, priority, title, body, url, dedupe_key, due_at)
    select u.id, 'daily_todo', 'normal',
           '📋 Today''s top ' || x.n || ': ' || x.first_nm,
           left(x.body, 220), './index.html', 'daily_todo:' || v_today, now()
      from public.users u
      cross join lateral (
          select count(*) n, (array_agg(t.name order by t.score desc))[1] first_nm,
                 string_agg(t.icon || ' ' || t.name || ' — ' || t.why, ' · ' order by t.score desc) body
            from public.journey_todo_for(u.id, 5) t) x
     where u.role_level between 3 and 12 and x.n > 0
       and coalesce(u.status, 'active') !~* 'inactive|deleted|resign|terminat'
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    return v_n;
end $$;
revoke all on function public.queue_daily_todo_push() from public, anon, authenticated;

-- A: Monday list of CPS with no 2nd meeting (last 30 days)
create or replace function public.queue_cps_no_next_push() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_today date := public.journey_today(); v_n int;
begin
    insert into public.notification_outbox (user_id, kind, priority, title, body, url, dedupe_key, due_at)
    select u.id, 'cps_no_next', 'normal',
           '🆕 ' || x.n || ' CPS with no 2nd meeting',
           left(x.names, 200) || ' · book a meeting or an event', './index.html', 'cps_no_next:' || v_today, now()
      from public.users u
      cross join lateral (
          select count(*) n, string_agg(t.name, ', ' order by t.due desc) names
            from public.journey_todo_for(u.id, 200) t where t.kind = 'cps') x
     where u.role_level between 3 and 12 and x.n > 0
       and coalesce(u.status, 'active') !~* 'inactive|deleted|resign|terminat'
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    return v_n;
end $$;
revoke all on function public.queue_cps_no_next_push() from public, anon, authenticated;

-- The to-do above only sees one row per person (its best reason), so the
-- Monday list re-ranks: the 'cps' rows of a 200-long list are every CPS gap.

-- 08:30 MYT daily · Monday 08:50 MYT
select cron.unschedule('journey-daily-todo') where exists (select 1 from cron.job where jobname = 'journey-daily-todo');
select cron.schedule('journey-daily-todo', '30 0 * * *', 'select public.queue_daily_todo_push();');
select cron.unschedule('journey-cps-no-next') where exists (select 1 from cron.job where jobname = 'journey-cps-no-next');
select cron.schedule('journey-cps-no-next', '50 0 * * 1', 'select public.queue_cps_no_next_push();');

-- ── 7. G · Journey funnel ───────────────────────────────────────────────────
-- Cohort = prospects whose CPS falls in [p_from, p_to]. Each later step is
-- counted for that cohort, so the drop-off between steps is real.
create or replace function public.journey_funnel(p_from date, p_to date)
returns table (agent_id bigint, agent_name text, cps int, met_again int, potential int, event int,
               signed int, collected int, gr6 int, referral int)
language plpgsql stable security definer set search_path = public as $$
declare v_uid bigint := public.current_user_row_id(); v_lvl int := coalesce(public.current_user_level(), 99);
begin
    if v_uid is null and v_lvl > 2 then return; end if;
    return query
    with scope as (
        select u.id from public.users u
         where v_lvl <= 2 or u.id in (select public.pipeline_tree_ids(v_uid, v_lvl between 3 and 5))
    ),
    coh as (
        select p.id pid, p.responsible_agent_id aid, min(a.activity_date) cps_d, coalesce(p.open_potential_rm, 0) rm,
               (select c.id from public.customers c where c.converted_from_prospect_id = p.id order by c.id limit 1) cid
          from public.prospects p join public.activities a on a.prospect_id = p.id and a.activity_type = 'CPS'
         where a.activity_date between p_from and p_to and p.responsible_agent_id in (select id from scope)
         group by p.id
    ),
    f as (
        select coh.*,
            exists (select 1 from public.activities a where (a.prospect_id = coh.pid or (coh.cid is not null and a.customer_id = coh.cid))
                      and a.activity_date > coh.cps_d and a.activity_date <= public.journey_today()
                      and a.activity_type in ('CPS', 'FTF', 'FSA', 'SITE', 'GR', 'EVENT', 'EVENT_CLOSING'))
            or exists (select 1 from public.event_attendees ea join public.events e on e.id = ea.event_id
                        left join public.activities ac on ac.id = ea.activity_id
                        where ea.attendee_type = 'prospect' and ea.entity_id = coh.pid
                          and (ea.attended or ea.attendance_status = 'Attended')
                          and coalesce(ac.activity_date, nullif(e.date::text, '')::date) >= coh.cps_d) as met,
            exists (select 1 from public.event_attendees ea join public.events e on e.id = ea.event_id
                        left join public.activities ac on ac.id = ea.activity_id
                        where ea.attendee_type = 'prospect' and ea.entity_id = coh.pid
                          and (ea.attended or ea.attendance_status = 'Attended')
                          and coalesce(ac.activity_date, nullif(e.date::text, '')::date) >= coh.cps_d) as ev,
            (select min(pu.id) from public.purchases pu
              where (pu.prospect_id = coh.pid or (coh.cid is not null and pu.customer_id = coh.cid))
                and pu.date >= coh.cps_d and pu.amount > 0 and coalesce(pu.status, '') !~* 'cancel|refund|void') as sale_id
          from coh
    )
    select f.aid, coalesce(u.full_name, '—'),
           count(*)::int,
           count(*) filter (where f.met)::int,
           count(*) filter (where f.rm > 0 or f.sale_id is not null)::int,
           count(*) filter (where f.ev)::int,
           count(*) filter (where f.sale_id is not null)::int,
           count(*) filter (where f.sale_id is not null and (
                exists (select 1 from public.delivery_items di join public.purchases pu on pu.id = di.purchase_id
                         where (pu.prospect_id = f.pid or (f.cid is not null and pu.customer_id = f.cid)) and di.status <> 'pending')
                or exists (select 1 from public.purchases pu where (pu.prospect_id = f.pid or (f.cid is not null and pu.customer_id = f.cid))
                            and pu.date >= f.cps_d and pu.delivery_status ~* 'deliver|collect|picked')))::int,
           count(*) filter (where f.sale_id is not null and (
                select count(*) from public.activities a where a.activity_type = 'GR'
                   and (a.prospect_id = f.pid or (f.cid is not null and a.customer_id = f.cid))
                   and a.activity_date >= (select pu.date from public.purchases pu where pu.id = f.sale_id)) >= 6)::int,
           count(*) filter (where exists (select 1 from public.prospects r
                where coalesce(lower(r.referred_by_type), '') not in ('consultant', 'agent')
                  and (r.referred_by_id = f.pid or (f.cid is not null and r.referred_by_id = f.cid))))::int
      from f left join public.users u on u.id = f.aid
     group by f.aid, u.full_name
     order by count(*) desc;
end $$;
revoke all on function public.journey_funnel(date, date) from public, anon;
grant execute on function public.journey_funnel(date, date) to authenticated;

-- A: the CPS prompt writes the choice with the viewer's own rights (RLS on
-- prospects), via this tiny RPC so it works for every role that can see them.
create or replace function public.set_cps_next_step(p_pid bigint, p_step text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
    if p_step not in ('meeting', 'event', 'not_interested', 'later') then return false; end if;
    if not public.prospect_is_visible(p_pid) then return false; end if;
    update public.prospects set cps_next_step = p_step, cps_next_step_at = now() where id = p_pid;
    if not found then return false; end if;
    if p_step = 'not_interested' then
        update public.journey_touchpoints set status = 'skipped', notes = coalesce(notes || ' · ', '') || 'auto: not interested'
         where prospect_id = p_pid and product_track = 'pr' and status = 'pending';
    end if;
    return true;
end $$;
revoke all on function public.set_cps_next_step(bigint, text) from public, anon;
grant execute on function public.set_cps_next_step(bigint, text) to authenticated;

-- ── 8. Backfill ─────────────────────────────────────────────────────────────
-- Ready dates for this year's items still waiting (older ones are left alone:
-- they were very likely collected and just never ticked).
update public.delivery_items di set expected_ready_date = expected_ready_date
 where di.status = 'pending' and di.expected_ready_date is null
   and exists (select 1 from public.purchases p where p.id = di.purchase_id and p.date >= public.journey_today() - 365);
-- (the BEFORE trigger fills the date; the AFTER trigger adds Step 3/4 + Golden Road)

-- Step 3/4 + Golden Road for items that already had a ready date
select public.journey_item_sync(di.id) from public.delivery_items di
 where di.status = 'pending' and di.expected_ready_date >= public.journey_today() - 120;

-- Ring track for everyone with ring potential we're working now
select public.journey_pr_sync(p.id) from public.prospects p
 where coalesce(p.status, '') not in ('converted', 'lost')
   and (coalesce(p.last_activity_date, p.created_at::date) >= public.journey_today() - 183 or coalesce(p.open_potential_rm, 0) > 0)
   and (public.journey_is_ring(p.cps_interest) or coalesce(p.cps_interest, '') ~ '个人改命'
        or exists (select 1 from jsonb_array_elements(coalesce(p.open_potential_detail -> 'items', '[]'::jsonb)) i
                    where public.journey_is_ring(i ->> 'label')));
