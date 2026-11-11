-- migrations/2026-11-11_office_steps_phase2_UNDO.sql
-- Puts back what 2026-11-11_office_steps_phase2.sql replaced (the live
-- definitions as of 2026-11-11, before Phase 2). The Phase 1 tables stay.

do $$
begin
    if exists (select 1 from cron.job where jobname = 'office-step-reminders') then
        perform cron.unschedule('office-step-reminders');
    end if;
end $$;
drop function if exists public.queue_office_step_reminders();

drop trigger if exists trg_journey_item_after on public.delivery_items;
create trigger trg_journey_item_after
    after insert or update of expected_ready_date, status
    on public.delivery_items for each row execute function public.journey_item_after_trg();

CREATE OR REPLACE FUNCTION public.journey_item_sync(p_item bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.queue_delivery_ready_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_n     integer;
begin
  insert into public.notification_outbox (user_id, kind, priority, title, body, url, dedupe_key, due_at)
  select a.agent_id,
         'delivery_ready',
         'normal',
         '📦 Ready in ' || (di.expected_ready_date - v_today) || ' days',
         to_char(di.expected_ready_date, 'FMDD Mon') || ' · ' || left(di.item_name, 40)
           || coalesce(' | ' || nullif(c.full_name, ''), ''),
         './index.html?delivery=1#customers',
         'delivery_ready:' || di.id || ':' || di.expected_ready_date,
         now()
    from public.delivery_items di
    join public.customers c on c.id = di.customer_id
    left join public.purchases p on p.id = di.purchase_id
    cross join lateral (select coalesce(p.agent_id, c.responsible_agent_id) as agent_id) a
   where di.status = 'pending'
     and di.expected_ready_date between v_today and v_today + 30
     and a.agent_id is not null
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

create or replace function public.journey_todo_rows(p_uid bigint, p_limit integer default 5, p_agent_view boolean default true)
 returns table(kind text, icon text, prospect_id bigint, customer_id bigint, name text, why text, rm numeric, due date,
               score numeric, ref_id bigint, row_key text, hidden_until date, hidden_action text, shown_days integer)
 language sql stable security definer set search_path to 'public'
as $function$
with t as (select public.journey_today() d),
c as (   -- ① collections: ready ≤ 7 days, not handed over
    select 'collect'::text kind, '📦'::text icon, cu.converted_from_prospect_id pid, cu.id cid, cu.full_name nm,
           case when di.expected_ready_date < t.d then 'Collect ' || left(di.item_name, 30) || ' · ready since ' || to_char(di.expected_ready_date, 'FMDD Mon')
                else 'Ready ' || to_char(di.expected_ready_date, 'FMDD Mon') || ' · book the collection + photo' end why,
           coalesce(pu.amount, 10000)::numeric rm, di.expected_ready_date due,
           greatest(coalesce(pu.amount, 10000), 3000)::numeric money,
           (case when di.expected_ready_date < t.d then 3 else 2 end
             * (1 + least(greatest(t.d - di.expected_ready_date, 0), 30) / 30.0))::numeric urg,
           di.purchase_id ref
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
