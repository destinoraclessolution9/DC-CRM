-- ═══════════════════════════════════════════════════════════════════════════
-- Order-form photo: attach later (owner 2026-10-22)
--
-- The Meeting Outcome closing may now be saved without its order-form photo
-- (slow / failed upload). Until a photo tagged with that closing activity
-- (prospect_attachments.metadata.activity_id) exists, the closer's 📋 top 5
-- shows "📸 Attach the order form photo" (kind 'photo', ref_id = activity id),
-- and it counts as overdue from the next day.
-- Only closings dated / saved from 22 Oct 2026 — older ones were photo-gated.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.journey_todo_for(p_uid bigint, p_limit integer DEFAULT 5)
 RETURNS TABLE(kind text, icon text, prospect_id bigint, customer_id bigint, name text, why text, rm numeric, due date, score numeric, ref_id bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
pop as ( -- ⑥ POP charge lapsed → collect the manual bank-in receipt
    select 'pop', '💳', cu.converted_from_prospect_id, cu.id, cu.full_name,
           'POP lapsed · ' || to_char(i.due_date, 'FMMon') || ' RM' || round(i.amount) || ' — collect the bank-in receipt',
           i.amount, i.due_date,
           greatest(x.left_rm, 3000) * 2.5 * (1 + least(greatest(t.d - coalesce(i.lapsed_at, i.due_date), 0), 60) / 60.0), i.purchase_id
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
           greatest(coalesce(pu.amount, 5000), 3000) * 1.5 * (1 + least(greatest(t.d - a.expected_back, 0), 60) / 60.0), a.id
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
           greatest(coalesce(pr.open_potential_rm, 0), 5000) * 2 * case when a.activity_type = 'CPS' then 1.2 else 1 end, a.id
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
           greatest(coalesce(a.closing_amount, 0), 5000) * 3 * (1 + least(greatest(t.d - a.activity_date, 0), 30) / 30.0), a.id
      from public.activities a cross join t
      join public.prospects pr on pr.id = a.prospect_id
      left join lateral (select c2.id, c2.full_name from public.customers c2
                          where c2.converted_from_prospect_id = a.prospect_id order by c2.id limit 1) cu on true
     where a.is_closing and coalesce(a.lead_agent_id, pr.responsible_agent_id) = p_uid
       -- only closings saved once "attach later" existed; older ones were photo-gated
       and greatest(a.activity_date, (a.created_at at time zone 'Asia/Kuala_Lumpur')::date) >= date '2026-10-22'
       and a.activity_date <= t.d
       and not exists (select 1 from public.prospect_attachments pa
                        where pa.prospect_id = a.prospect_id and pa.attachment_type = 'order_form'
                          and pa.metadata->>'activity_id' = a.id::text)
),
allx as (select * from c union all select * from mins union all select * from g union all select * from cps union all select * from hot union all select * from tp union all select * from pop union all select * from adv union all select * from ofp),
best as (
    select distinct on (coalesce('c' || cid::text, 'p' || pid::text)) * from allx
     where nm is not null
     order by coalesce('c' || cid::text, 'p' || pid::text), sc desc
)
select kind, icon, pid, cid, nm, why, rm, due, round(sc), ref from best order by sc desc limit greatest(coalesce(p_limit, 5), 1)
$function$;

revoke all on function public.journey_todo_for(bigint, integer) from public, anon, authenticated;

-- overdue now includes a missing photo
create or replace function public.journey_todo_counts(p_uids bigint[])
 RETURNS TABLE(agent_id bigint, todo_n integer, overdue_n integer, last_activity date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    with t as (select (now() at time zone 'Asia/Kuala_Lumpur')::date d),
    u as (select x.id from unnest(p_uids) x(id) where x.id in (select public.pop_scope_ids()))
    select u.id,
           (select count(*) from public.journey_todo_for(u.id, 200))::int,
           (select count(*) from public.journey_todo_for(u.id, 200) j cross join t
             where j.due < t.d and j.kind in ('collect', 'gr', 'touch', 'pop', 'advance', 'photo'))::int,
           (select max(a.activity_date) from public.activities a cross join t
             where a.lead_agent_id = u.id and a.activity_date <= t.d
               and a.activity_type not in ('PERSONAL', 'AGENT_MEETING'))
      from u
$function$;
revoke all on function public.journey_todo_counts(bigint[]) from public, anon;
grant execute on function public.journey_todo_counts(bigint[]) to authenticated;
