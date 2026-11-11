-- migrations/2026-11-11_office_phase3_UNDO.sql
-- Puts back what 2026-11-11_office_phase3.sql replaced (live definitions as of
-- 2026-11-11 before Phase 3). Advances whose owed-back date moved to the office
-- date keep that date.
drop trigger if exists trg_delivery_advance_office on public.delivery_items;
drop function if exists public.delivery_advance_office_trg();
drop function if exists public.office_lead_times();
drop function if exists public.office_lead_group(text);
drop table if exists public.office_lead_history;

CREATE OR REPLACE FUNCTION public.journey_item_profile(p_item text, OUT lead_days integer, OUT gr_sessions integer, OUT is_ring boolean)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_group text;
begin
    is_ring := public.journey_is_ring(p_item);
    -- 1a. products whose FULL name is in the text ("天至喜4 Tian Zhi Xi 4");
    --     several items on one sale → the slowest one decides when it is ready
    select max(public.journey_lead_days(pr.delivery_lead_time)), max(pr.golden_road_sessions)
      into lead_days, gr_sessions
      from public.products pr
     where coalesce(pr.is_active, true) and length(pr.name) >= 3
       and position(lower(pr.name) in lower(coalesce(p_item, ''))) > 0;
    -- 1b. otherwise a looser name match (full Chinese or English half), slowest wins
    if lead_days is null then
        select max(public.journey_lead_days(pr.delivery_lead_time)), coalesce(gr_sessions, max(pr.golden_road_sessions))
          into lead_days, gr_sessions
          from public.products pr
         where coalesce(pr.is_active, true) and public.pipeline_name_match(p_item, pr.name);
    end if;
    -- 2. otherwise the product group by keyword (the group's usual lead time)
    if lead_days is null or (is_ring and gr_sessions is null) then
        v_group := public.journey_item_group(p_item);
        if v_group is not null then
            select coalesce(lead_days, mode() within group (order by public.journey_lead_days(pr.delivery_lead_time))),
                   coalesce(gr_sessions, max(pr.golden_road_sessions))
              into lead_days, gr_sessions
              from public.products pr
             where pr.subcategory = v_group and coalesce(pr.is_active, true) and pr.delivery_lead_time is not null;
        end if;
    end if;
    if gr_sessions is not null and gr_sessions <= 0 then gr_sessions := null; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.delivery_advance_fill()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare di record; pu record; prof record;
begin
    select * into di from public.delivery_items where id = new.delivery_item_id;
    if di.id is null then raise exception 'Delivery item not found'; end if;
    if tg_op = 'INSERT' then
        if not public.delivery_advance_allowed(di.item_name) then
            raise exception 'Only calligraphy, artistic masterpieces and 财库/财托 can come from an agent''s own stock';
        end if;
        if di.status = 'pending' then
            raise exception 'Hand the item over to the customer first';
        end if;
        select * into pu from public.purchases where id = di.purchase_id;
        new.customer_id   := di.customer_id;
        new.item_name     := di.item_name;
        new.given_date    := coalesce(new.given_date, di.handover_date);
        new.sale_agent_id := coalesce(new.sale_agent_id, pu.agent_id,
                                      (select responsible_agent_id from public.customers where id = di.customer_id));
        -- the office piece should arrive when the order would have been ready
        if new.expected_back is null then
            prof := public.journey_item_profile(di.item_name);
            new.expected_back := coalesce(di.expected_ready_date,
                                          (coalesce(pu.date, new.given_date) + coalesce(prof.lead_days, 120)));
        end if;
        new.created_by := coalesce(new.created_by, public.current_user_row_id());
    end if;
    if tg_op = 'UPDATE' and new.status = 'returned' and old.status = 'owed' then
        new.returned_by := coalesce(public.current_user_row_id(), new.returned_by);
    end if;
    if new.status = 'owed' then new.returned_date := null; end if;
    new.updated_at := now();
    return new;
end $function$;

CREATE OR REPLACE FUNCTION public.queue_advance_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date; v_n int;
begin
    insert into public.notification_outbox (user_id, kind, priority, title, body, url, dedupe_key, due_at)
    select x.uid, 'advance_due', 'normal',
           case when x.uid = a.lender_agent_id then '↩ Collect your stock back' else '↩ Return stock to ' || coalesce(l.full_name, 'the agent') end,
           left(a.item_name, 40) || ' · lent to ' || coalesce(c.full_name, 'customer') || ' on ' || to_char(a.given_date, 'FMDD Mon')
             || case when v_today > a.expected_back then ' · ' || (v_today - a.expected_back) || ' days late' else ' · office piece due today' end,
           './index.html?delivery=1#customers',
           'advance_due:' || a.id || ':' || x.uid || ':' || v_today, now()
      from public.delivery_advances a
      left join public.customers c on c.id = a.customer_id
      left join public.users l on l.id = a.lender_agent_id
      cross join lateral (select a.lender_agent_id uid
                          union select a.sale_agent_id where a.sale_agent_id is not null and a.sale_agent_id <> a.lender_agent_id) x
     where a.status = 'owed' and a.expected_back is not null
       and v_today >= a.expected_back and (v_today - a.expected_back) % 7 = 0
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    return v_n;
end $function$;

create or replace function public.journey_todo_rows(p_uid bigint, p_limit integer default 5, p_agent_view boolean default true)
 returns table(kind text, icon text, prospect_id bigint, customer_id bigint, name text, why text, rm numeric, due date,
               score numeric, ref_id bigint, row_key text, hidden_until date, hidden_action text, shown_days integer)
 language sql stable security definer set search_path to 'public'
as $function$
with t as (select public.journey_today() d),
c as (   -- ① collections, one step at a time (office notices, Phase 2 2026-11-11):
         --   📦 no office word yet: ready ≤ 7 days by the estimate (as before)
         --   🏢 the office says it is ready → collect it from the office
         --   📲 collected → tell the customer
         --   🤝 told 14+ days ago and still not handed over → book the handover
    select 'collect'::text kind,
           (case s.stage when 'told' then '🤝' when 'collected' then '📲' when 'office' then '🏢' else '📦' end)::text icon,
           cu.converted_from_prospect_id pid, cu.id cid, cu.full_name nm,
           case s.stage
                when 'told' then 'Told ' || to_char(s.told, 'FMDD Mon') || ' · ' || left(di.item_name, 30) || ' not collected yet · book the handover + photo'
                when 'collected' then 'Tell the customer · ' || left(di.item_name, 30) || ' collected ' || to_char(di.collected_at, 'FMDD Mon')
                when 'office' then 'Collect ' || left(di.item_name, 30) || ' from the office'
                                   || coalesce(' · ' || nullif(di.office_ready_place, ''), '') || ' · ready ' || to_char(di.office_ready_date, 'FMDD Mon')
                when 'late' then 'Collect ' || left(di.item_name, 30) || ' · ready since ' || to_char(di.expected_ready_date, 'FMDD Mon')
                else 'Ready ' || to_char(di.expected_ready_date, 'FMDD Mon') || ' · book the collection + photo' end why,
           coalesce(pu.amount, 10000)::numeric rm, s.due due,
           greatest(coalesce(pu.amount, 10000), 3000)::numeric money,
           (case s.stage when 'soon' then 2 when 'told' then 2.5 else 3 end
             * (1 + least(greatest(t.d - s.due, 0), 30) / 30.0))::numeric urg,
           di.purchase_id ref
      from public.delivery_items di cross join t
      join public.customers cu on cu.id = di.customer_id
      left join public.purchases pu on pu.id = di.purchase_id
      cross join lateral (select (di.customer_told_at at time zone 'Asia/Kuala_Lumpur')::date told) tt
      cross join lateral (select tt.told,
            case when tt.told is not null then 'told'
                 when di.collected_at is not null then 'collected'
                 when di.office_ready_date is not null then 'office'
                 when di.expected_ready_date < t.d then 'late'
                 else 'soon' end stage,
            case when tt.told is not null then tt.told + 14
                 when di.collected_at is not null then di.collected_at
                 when di.office_ready_date is not null then di.office_ready_date
                 else di.expected_ready_date end due) s
     where di.status = 'pending'
       and coalesce(pu.agent_id, cu.responsible_agent_id) = p_uid
       and case s.stage
             when 'told' then s.due <= t.d
             when 'collected' then di.collected_at >= t.d - 400
             when 'office' then di.office_ready_date <= t.d and di.office_ready_date >= t.d - 400
             else di.expected_ready_date <= t.d + 7 and di.expected_ready_date >= t.d - 120 end
),
g as (   -- ② Golden Road session due
    select 'gr', '🟣', coalesce(tp.prospect_id, cu.converted_from_prospect_id), tp.customer_id, coalesce(cu.full_name, pr.full_name),
           'Golden Road ' || tp.seq || '/' || tp.seq_total || case when tp.due_date < t.d then ' · overdue' else ' · due ' || to_char(tp.due_date, 'FMDD Mon') end,
           coalesce(pu.amount, 10000), tp.due_date,
           greatest(coalesce(pu.amount, 10000), 3000),
           2 * (1 + least(greatest(t.d - tp.due_date, 0), 30) / 30.0),
           tp.purchase_id
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
           greatest(coalesce(p.open_potential_rm, 0), 5000),
           1.5 * case when t.d - x.d <= 14 then 1.2 else 0.8 end,
           null::bigint
      from public.prospects p cross join t
      cross join lateral (select max(a.activity_date) d from public.activities a where a.prospect_id = p.id and a.activity_type = 'CPS') x
     where p.responsible_agent_id = p_uid and x.d between t.d - 30 and t.d - 1
       and coalesce(p.status, '') not in ('converted', 'lost') and not coalesce(p.unable_to_serve, false)
       and coalesce(p.manual_grade, '') <> 'F' and coalesce(p.cps_next_step, '') <> 'not_interested'
       -- the CPS must have its minutes first (an empty one is the "minutes" row below)
       and exists (select 1 from public.activities a where a.prospect_id = p.id and a.activity_type = 'CPS'
                     and a.activity_date = x.d and public.activity_has_minutes(a))
       and not exists (select 1 from public.activities a where a.prospect_id = p.id and a.activity_date > x.d
                         and a.activity_type in ('CPS', 'FTF', 'FSA', 'SITE', 'GR', 'EVENT', 'EVENT_CLOSING'))
       and not exists (select 1 from public.event_attendees ea where ea.attendee_type = 'prospect' and ea.entity_id = p.id
                         and ea.created_at::date >= x.d)
),
hot as ( -- ④ Commit / Audit / Hot with nothing booked
    select 'book', case p.potential_tier when 'commit' then '🟢' when 'audit' then '🩺' else '🔥' end, p.id, null::bigint, p.full_name,
           initcap(p.potential_tier) || ' · RM' || round(p.open_potential_rm / 1000) || 'k · nothing booked'
             || coalesce(case when lm.met then ' · met ' else ' · last contact ' end || to_char(p.potential_last_met, 'FMDD Mon'), ''),
           p.open_potential_rm, p.potential_last_met,
           p.open_potential_rm,
           case p.potential_tier when 'commit' then 3 when 'audit' then 2 else 1.5 end
             * (1 + least(coalesce(t.d - p.potential_last_met, 60), 60) / 60.0),
           null::bigint
      from public.prospects p cross join t
      -- potential_last_met counts calls too: say "met" only for a real meeting
      cross join lateral (select p.potential_last_met is not null and (
               exists (select 1 from public.activities a
                        where a.prospect_id = p.id and a.activity_date::date = p.potential_last_met
                          and a.activity_type in ('CPS', 'FTF', 'FSA', 'SITE', 'EVENT', 'EVENT_CLOSING', 'AGENT_MEETING', 'GR'))
            or exists (select 1 from public.customers c2 join public.activities a on a.customer_id = c2.id
                        where c2.converted_from_prospect_id = p.id and a.activity_date::date = p.potential_last_met
                          and a.activity_type in ('CPS', 'FTF', 'FSA', 'SITE', 'EVENT', 'EVENT_CLOSING', 'AGENT_MEETING', 'GR'))
            or exists (select 1 from public.event_attendees ea join public.events e on e.id = ea.event_id
                        where ea.attendee_type = 'prospect' and ea.entity_id = p.id
                          and (ea.attended or ea.attendance_status = 'Attended')
                          and nullif(e.date::text, '')::date = p.potential_last_met)) met) lm
     where p.responsible_agent_id = p_uid and p.potential_tier in ('commit', 'audit', 'hot')
       and p.potential_next_booked is null and p.open_potential_rm > 0
),
tp as (  -- ⑤ any other journey step due today or overdue
    select 'touch', '🧭', coalesce(j.prospect_id, cu.converted_from_prospect_id), j.customer_id, coalesce(cu.full_name, pr.full_name),
           regexp_replace(j.title, '^\S+\s+', '') || case when j.due_date < t.d then ' · overdue' else '' end,
           coalesce(nullif(pr.open_potential_rm, 0), 3000), j.due_date,
           greatest(coalesce(pr.open_potential_rm, 0), 3000),
           case when j.priority = 'high' then 1.2 else 1 end * (1 + least(greatest(t.d - j.due_date, 0), 30) / 30.0),
           j.id
      from public.journey_touchpoints j cross join t
      left join public.customers cu on cu.id = j.customer_id
      left join public.prospects pr on pr.id = j.prospect_id
     where j.status = 'pending' and j.seq is null and j.assigned_to_id = p_uid and j.due_date <= t.d
       and j.due_date >= t.d - 60 and coalesce(j.snooze_until, t.d) <= t.d
),
pop as ( -- ⑥ POP charge lapsed → collect the manual bank-in receipt
    select 'pop', '💳', cu.converted_from_prospect_id, cu.id, cu.full_name,
           'POP lapsed · ' || to_char(i.due_date, 'FMMon') || ' RM' || round(i.amount) || ' — collect the bank-in receipt',
           i.amount, i.due_date,
           greatest(x.left_rm, 3000),
           2.5 * (1 + least(greatest(t.d - coalesce(i.lapsed_at, i.due_date), 0), 60) / 60.0),
           i.purchase_id
      from public.pop_installments i cross join t
      join public.customers cu on cu.id = i.customer_id
      cross join lateral (select coalesce(sum(j.amount) filter (where j.status in ('due', 'lapsed')), 0) left_rm
                            from public.pop_installments j where j.purchase_id = i.purchase_id) x
     where i.agent_id = p_uid and i.status = 'lapsed'
),
adv as ( -- ⑦ my own stock lent to a customer: office piece due → collect it back
    select 'advance', '↩', cu.converted_from_prospect_id, cu.id, cu.full_name,
           'Collect your ' || left(a.item_name, 24) || ' back · lent ' || to_char(a.given_date, 'FMDD Mon')
             || case when a.expected_back < t.d then ' · ' || (t.d - a.expected_back) || ' days late' else ' · office piece due' end,
           coalesce(pu.amount, 5000), a.expected_back,
           greatest(coalesce(pu.amount, 5000), 3000),
           1.5 * (1 + least(greatest(t.d - a.expected_back, 0), 60) / 60.0),
           a.id
      from public.delivery_advances a cross join t
      join public.customers cu on cu.id = a.customer_id
      left join public.delivery_items di on di.id = a.delivery_item_id
      left join public.purchases pu on pu.id = di.purchase_id
     where a.lender_agent_id = p_uid and a.status = 'owed' and a.expected_back <= t.d + 3
),
mins as ( -- ⓪ a CPS / FTF that already happened with no minutes yet (≤ 14 days)
    select 'minutes', '📝', a.prospect_id, null::bigint, pr.full_name,
           'Fill the ' || a.activity_type || ' minutes · ' || to_char(a.activity_date, 'FMDD Mon')
             || case when t.d - a.activity_date = 1 then ' (yesterday)' else ' (' || (t.d - a.activity_date) || ' days ago)' end,
           coalesce(nullif(pr.open_potential_rm, 0), 5000), a.activity_date,
           greatest(coalesce(pr.open_potential_rm, 0), 5000),
           2 * case when a.activity_type = 'CPS' then 1.2 else 1 end,
           a.id
      from public.activities a cross join t
      join public.prospects pr on pr.id = a.prospect_id
     where a.activity_type in ('CPS', 'FTF') and a.activity_date between t.d - 14 and t.d - 1
       and coalesce(a.lead_agent_id, pr.responsible_agent_id) = p_uid
       and coalesce(pr.status, '') not in ('converted', 'lost') and not coalesce(pr.unable_to_serve, false)
       and not public.activity_has_minutes(a)
       and not exists (select 1 from public.activities b where b.prospect_id = a.prospect_id and b.id <> a.id
                         and b.activity_date > a.activity_date and b.activity_date <= t.d
                         and b.activity_type in ('CPS', 'FTF', 'FSA', 'SITE', 'GR', 'EVENT_CLOSING'))
),
ofp as ( -- ⑧ a closing saved without its order-form photo (attach later — owner 2026-10-22)
    select 'photo', '📸', a.prospect_id, cu.id, coalesce(cu.full_name, pr.full_name),
           'Attach the order form photo · closed ' || to_char(a.activity_date, 'FMDD Mon'),
           coalesce(nullif(a.closing_amount, 0), 5000), a.activity_date,
           greatest(coalesce(a.closing_amount, 0), 5000),
           3 * (1 + least(greatest(t.d - a.activity_date, 0), 30) / 30.0),
           a.id
      from public.activities a cross join t
      join public.prospects pr on pr.id = a.prospect_id
      left join lateral (select c2.id, c2.full_name from public.customers c2
                          where c2.converted_from_prospect_id = a.prospect_id order by c2.id limit 1) cu on true
     where a.is_closing and coalesce(a.lead_agent_id, pr.responsible_agent_id) = p_uid
       -- owner 2026-10-22: every closing from 1 Jan 2026
       and a.activity_date >= date '2026-01-01' and a.activity_date <= t.d
       and not exists (select 1 from public.prospect_attachments pa
                        where pa.prospect_id = a.prospect_id and pa.attachment_type = 'order_form'
                          and pa.metadata->>'activity_id' = a.id::text)
       -- before 22 Oct photos were not tagged with their closing: any order-form
       -- photo or invoice on the prospect's closing record counts as attached
       and not (a.activity_date < date '2026-10-22' and (
                exists (select 1 from public.prospect_attachments pa
                         where pa.prospect_id = a.prospect_id and pa.attachment_type = 'order_form')
             or nullif(pr.closing_record->>'invoice_file', '') is not null
             or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(pr.closing_records_history) = 'array'
                                                               then pr.closing_records_history else '[]'::jsonb end) h
                         where nullif(h->>'invoice_file', '') is not null)))
),
allx as (select * from c union all select * from mins union all select * from g union all select * from cps union all select * from hot
         union all select * from tp union all select * from pop union all select * from adv union all select * from ofp),
k as (select x.*, public.journey_todo_key(x.kind, x.pid, x.cid, x.ref) rk from allx x where x.nm is not null),
hid as ( -- rows I put away that are still away
    select z.row_key, z.until, z.action from public.todo_snoozes z cross join t
     where z.user_id = p_uid and z.until > t.d
),
seen as ( -- days each row was in my morning top 5 over the last week (today not counted)
    select h.row_key, count(*)::int n from public.todo_shown h cross join t
     where h.user_id = p_uid and h.day between t.d - 7 and t.d - 1
     group by h.row_key
),
scored as (
    select k.*, hid.until h_until, hid.action h_action, coalesce(seen.n, 0) n,
           -- money counts up to RM30k, then urgency decides; fatigue only in the agent's own view
           least(k.money, 30000) * k.urg
             * case when p_agent_view and coalesce(seen.n, 0) >= 3 then power(0.5, coalesce(seen.n, 0) - 2) else 1 end sc
      from k
      left join hid on hid.row_key = k.rk
      left join seen on seen.row_key = k.rk
     where not (p_agent_view and hid.row_key is not null)
),
best as (
    select distinct on (coalesce('c' || cid::text, 'p' || pid::text)) * from scored
     order by coalesce('c' || cid::text, 'p' || pid::text), sc desc
)
select kind, icon, pid, cid, nm, why, rm, due, round(sc), ref, rk, h_until, h_action, n
  from best order by sc desc, rk limit greatest(coalesce(p_limit, 5), 1)
$function$;
revoke all on function public.journey_todo_rows(bigint, integer, boolean) from public, anon, authenticated;

drop function if exists public.journey_numbered_match(text, text);
drop function if exists public.office_t2s(text);
