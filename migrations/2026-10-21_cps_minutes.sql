-- ═══════════════════════════════════════════════════════════════════════════
-- CPS / FTF minutes (owner 2026-10-21)
--
-- A CPS is usually keyed in as a FUTURE appointment, so asking "What's next?"
-- at that moment is useless. Instead:
--   · 08:30 the morning after a CPS / FTF (and again on day 3) the owner of the
--     appointment gets "📝 Fill in the minutes" when nothing was written and no
--     later meeting was logged; the push opens that appointment's minutes form
--   · the 📋 top 5 shows "📝 Fill the CPS minutes" for up to 14 days
--   · "CPS with no 2nd meeting" only starts once the CPS has its minutes
--   · team leaders' Monday push adds "N CPS/FTF without minutes"
--   (the "What's next?" prompt itself now opens after the minutes are saved)
-- ═══════════════════════════════════════════════════════════════════════════

-- What counts as "filled": any written note, meeting minutes, potential, a
-- closing, or the meeting marked as not happened (unable to serve).
create or replace function public.activity_has_minutes(a public.activities) returns boolean
language sql stable as $$
    select coalesce(a.is_closing, false) or coalesce(a.unable_to_serve, false)
        or coalesce(nullif(btrim(a.note_key_points), ''), nullif(btrim(a.summary), ''), nullif(btrim(a.discussion_summary), ''),
                    nullif(btrim(a.note_outcome), ''), nullif(btrim(a.note_needs), ''), nullif(btrim(a.note_pain_points), ''),
                    nullif(btrim(a.opportunity_potential), ''), nullif(btrim(a.core_problem), '')) is not null
        or (a.meeting_minutes is not null and jsonb_typeof(a.meeting_minutes) = 'object'
            and exists (select 1 from jsonb_each_text(a.meeting_minutes) kv where nullif(btrim(kv.value), '') is not null
                          and kv.value not in ('[]', '{}', 'null', 'false')))
$$;

create or replace function public.queue_minutes_push() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date; v_n int;
begin
    insert into public.notification_outbox (user_id, kind, priority, title, body, url, dedupe_key, due_at)
    select coalesce(a.lead_agent_id, pr.responsible_agent_id), 'meeting_minutes', 'normal',
           '📝 ' || case when v_today - a.activity_date = 1 then 'Yesterday''s ' else '' end || a.activity_type || ' with ' || coalesce(pr.full_name, 'your prospect'),
           'Fill in the minutes and the next step' || case when v_today - a.activity_date > 1 then ' · ' || to_char(a.activity_date, 'FMDD Mon') else '' end,
           './index.html?minutes=' || a.id || '#calendar',
           'minutes:' || a.id || ':' || (v_today - a.activity_date), now()
      from public.activities a
      join public.prospects pr on pr.id = a.prospect_id
     where a.activity_type in ('CPS', 'FTF')
       and (v_today - a.activity_date) in (1, 3)
       and coalesce(a.lead_agent_id, pr.responsible_agent_id) is not null
       and coalesce(pr.status, '') not in ('converted', 'lost') and not coalesce(pr.unable_to_serve, false)
       and not public.activity_has_minutes(a)
       and not exists (select 1 from public.activities b where b.prospect_id = a.prospect_id and b.id <> a.id
                         and b.activity_date > a.activity_date and b.activity_date <= v_today
                         and b.activity_type in ('CPS', 'FTF', 'FSA', 'SITE', 'GR', 'EVENT_CLOSING'))
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    return v_n;
end $$;
revoke all on function public.queue_minutes_push() from public, anon, authenticated;
select cron.unschedule('meeting-minutes-push') where exists (select 1 from cron.job where jobname = 'meeting-minutes-push');
select cron.schedule('meeting-minutes-push', '30 0 * * *', 'select public.queue_minutes_push();');

-- ── 📋 top 5 (redefines the to-do function) ────────────────────────────────
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
allx as (select * from c union all select * from mins union all select * from g union all select * from cps union all select * from hot union all select * from tp union all select * from pop union all select * from adv),
best as (
    select distinct on (coalesce('c' || cid::text, 'p' || pid::text)) * from allx
     where nm is not null
     order by coalesce('c' || cid::text, 'p' || pid::text), sc desc
)
select kind, icon, pid, cid, nm, why, rm, due, round(sc), ref from best order by sc desc limit greatest(coalesce(p_limit, 5), 1)
$$;
revoke all on function public.journey_todo_for(bigint, integer) from public, anon, authenticated;
revoke all on function public.journey_todo_for(bigint, integer) from public, anon, authenticated;

-- ── Monday push for leaders (redefines it) ──
create or replace function public.queue_pipeline_weekly_push() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
    v_month text := to_char(v_today, 'YYYY-MM');
    v_end   date := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
    v_n     integer;
begin
    insert into public.notification_outbox (user_id, kind, priority, title, body, url, dedupe_key, due_at)
    select s.user_id, 'pipeline_weekly', 'normal',
           '🎯 ' || s.lbl || ': RM' || round(s.won / 1000) || 'k of RM' || round(s.goal / 1000) || 'k',
           case when s.goal - s.won <= 0 then 'Goal reached 🎉 keep closing'
                when s.pipe = 0 then 'No deals closing this month · add deals'
                else 'Pipeline ' || to_char(s.pipe / greatest(s.goal - s.won, 1), 'FM990.0') || '× (need 3×)'
           end
           || case when s.idle > 0 then ' · ' || s.idle || ' idle deal' || case when s.idle = 1 then '' else 's' end else '' end
           || coalesce(' · ' || nullif(s.no_deal, 0) || ' agent' || case when s.no_deal = 1 then '' else 's' end || ' no deals', '')
           || coalesce(' · behind most: ' || s.behind, '')
           || coalesce(' · ' || nullif(s.no_minutes, 0) || ' CPS/FTF without minutes', ''),
           './index.html#pipeline',
           'pipeline_weekly:' || v_today,
           now()
      from (
        select u.id as user_id,
               case when u.role_level between 3 and 5 then 'Team' else 'You' end as lbl,
               coalesce(g.target_amount, case when u.role_level between 3 and 5 then 500000 else 100000 end) as goal,
               coalesce((select sum(p.amount) from public.purchases p
                          where p.agent_id in (select public.pipeline_tree_ids(u.id, u.role_level between 3 and 5))
                            and left(p.date::text, 7) = v_month
                            and coalesce(p.status, '') !~* 'cancel|refund|void' and p.amount > 0), 0) as won,
               coalesce((select sum(d.amount) from public.pipeline_deals d
                          where d.agent_id in (select public.pipeline_tree_ids(u.id, u.role_level between 3 and 5))
                            and d.stage in ('interested','proposal','prescribed','closing')
                            and d.expected_close_date <= v_end), 0) as pipe,
               (select count(*) from public.pipeline_deals d left join public.prospects pr on pr.id = d.prospect_id
                 where d.agent_id in (select public.pipeline_tree_ids(u.id, u.role_level between 3 and 5))
                   and d.stage in ('interested','proposal','prescribed','closing')
                   and greatest(d.updated_at, coalesce(pr.last_activity_date::timestamptz, d.updated_at)) < now() - interval '14 days') as idle,
               -- leaders only: agents (L6–12) in the tree with no deal closing this month
               case when u.role_level between 3 and 5 then
                   (select count(*) from public.users a
                     where a.id in (select public.pipeline_tree_ids(u.id, true)) and a.id <> u.id
                       and a.role_level between 6 and 12
                       and coalesce(a.status, 'active') !~* 'inactive|deleted|resign|terminat'
                       and not exists (select 1 from public.pipeline_deals d where d.agent_id = a.id
                                        and d.stage in ('interested','proposal','prescribed','closing') and d.expected_close_date <= v_end))
               end as no_deal,
               case when u.role_level between 3 and 5 then
                   (select a.full_name || ' (RM' || round(greatest(100000 - coalesce(w.rm, 0), 0) / 1000) || 'k to go)'
                      from public.users a
                      left join lateral (select sum(p.amount) rm from public.purchases p
                                          where p.agent_id = a.id and left(p.date::text, 7) = v_month
                                            and coalesce(p.status, '') !~* 'cancel|refund|void' and p.amount > 0) w on true
                     where a.id in (select public.pipeline_tree_ids(u.id, true)) and a.id <> u.id
                       and a.role_level between 6 and 12
                       and coalesce(a.status, 'active') !~* 'inactive|deleted|resign|terminat'
                     order by coalesce(w.rm, 0) asc,
                              (select count(*) from public.pipeline_deals d where d.agent_id = a.id
                                and d.stage in ('interested','proposal','prescribed','closing') and d.expected_close_date <= v_end) asc,
                              a.full_name
                     limit 1)
               end as behind,
               case when u.role_level between 3 and 5 then
                   (select count(*) from public.activities a
                     where a.activity_type in ('CPS', 'FTF')
                       and a.activity_date between v_today - 7 and v_today - 1
                       and a.lead_agent_id in (select public.pipeline_tree_ids(u.id, true))
                       and not public.activity_has_minutes(a))
               end as no_minutes
          from public.users u
          left join public.pipeline_goals g
                 on g.user_id = u.id and g.month = v_month
                and g.scope = case when u.role_level between 3 and 5 then 'team' else 'personal' end
         where u.role_level between 3 and 12
           and coalesce(u.status, 'active') !~* 'inactive|deleted|resign|terminat'
      ) s
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    return v_n;
end $$;
revoke all on function public.queue_pipeline_weekly_push() from public, anon, authenticated;
revoke all on function public.queue_pipeline_weekly_push() from public, anon, authenticated;
