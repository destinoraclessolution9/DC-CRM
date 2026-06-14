-- Phase 1 (#12) — extended KPI aggregation RPC. Additive (pre-authorized).
--
-- calculateKPIs (chunks/script-reporting.js) computes 11 KPIs via the live
-- kpi_*/get_conversion_rate fast paths, BUT four headcounts still run
-- client-side on EVERY reporting render, each scanning getAll('activities')
-- (+ event_attendees / users): activityHeadcount, meetUpExistingCount,
-- cfHeadcount, activeAgents. They're the last per-render full-table pull on the
-- biggest table. This RPC returns all four in one jsonb, matching the existing
-- kpi_* convention (try-first, client fallback).
--
-- PARITY NOTES — must match the four getters EXACTLY (KPI numbers shown to the
-- boss; not flag-gated once wired, like the other kpi_* fast paths):
--   • meet_up_existing  (getMeetUpExistingCustomerCount): activities in [from,to]
--       where type in (FTF,FSA) OR title ILIKE '%golden road%'; scope on
--       lead_agent_id; role filter applies (agent-not-found OR role≠ -> excluded).
--   • cf_headcount       (getCFHeadcount): COUNT(DISTINCT customer_id) of CPS
--       activities in range with a customer_id; scope + role on lead_agent_id.
--   • activity_headcount (getActivityHeadcount): attended (attended=true OR
--       attendance_status='Attended') event_attendees whose activity_date is in
--       range. NO role filter. Scope resolves the agent from the attendee:
--       agent -> entity_id; customer -> customer.responsible_agent_id; else
--       (prospect/other) -> prospect.responsible_agent_id. NULL agent excluded
--       when scoped, all counted when unrestricted.
--   • active_agents      (getActiveAgents): ROLLING 60-day window (NOT from/to).
--       isAgent (role_level 3..12) + scope (NO role filter), where the agent
--       either led an activity in the last 60d OR attended (as attendee_type
--       'agent') an event whose EVENT activity_date is in the last 60d.
--   • Scope: p_agent_ids NULL = unrestricted (admin/manager); else bigint[] of
--       visible agent ids. p_role NULL/'All' = no role filter.

create or replace function public.kpi_extended_summary(
  p_from      date,
  p_to        date,
  p_agent_ids bigint[] default null,
  p_role      text     default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with cutoff as (
    select ((now() at time zone 'Asia/Kuala_Lumpur')::date - 60) as d
  ),
  meetup as (
    select count(*) c
    from activities a
    left join users u on u.id = a.lead_agent_id
    where a.activity_date >= p_from and a.activity_date <= p_to
      and (a.activity_type in ('FTF','FSA') or lower(coalesce(a.activity_title,'')) like '%golden road%')
      and (p_agent_ids is null or a.lead_agent_id = any(p_agent_ids))
      and (p_role is null or p_role = 'All' or u.role = p_role)
  ),
  cf as (
    select count(distinct a.customer_id) c
    from activities a
    left join users u on u.id = a.lead_agent_id
    where a.activity_type = 'CPS'
      and a.activity_date >= p_from and a.activity_date <= p_to
      and a.customer_id is not null
      and (p_agent_ids is null or a.lead_agent_id = any(p_agent_ids))
      and (p_role is null or p_role = 'All' or u.role = p_role)
  ),
  ah as (
    select count(*) c
    from event_attendees att
    join activities act on act.id = att.activity_id
    left join customers c  on att.attendee_type = 'customer'
                          and c.id  = coalesce(att.entity_id, att.attendee_id)
    left join prospects pr on att.attendee_type not in ('agent','customer')
                          and pr.id = coalesce(att.entity_id, att.attendee_id)
    where (att.attended is true or att.attendance_status = 'Attended')
      and act.activity_date >= p_from and act.activity_date <= p_to
      and (
        p_agent_ids is null
        or (case
              when att.attendee_type = 'agent'    then coalesce(att.entity_id, att.attendee_id)
              when att.attendee_type = 'customer' then c.responsible_agent_id
              else pr.responsible_agent_id
            end) = any(p_agent_ids)
      )
  ),
  recent_events as (
    select distinct a.event_id
    from activities a, cutoff
    where a.activity_type = 'EVENT' and a.event_id is not null and a.activity_date >= cutoff.d
  ),
  active_ids as (
    select a.lead_agent_id as uid
    from activities a, cutoff
    where a.lead_agent_id is not null and a.activity_date >= cutoff.d
    union
    select ea.entity_id as uid
    from event_attendees ea
    where ea.attendee_type = 'agent' and ea.entity_id is not null
      and ea.event_id in (select event_id from recent_events)
  ),
  aa as (
    select count(*) c
    from users u
    where u.role_level between 3 and 12
      and (p_agent_ids is null or u.id = any(p_agent_ids))
      and u.id in (select uid from active_ids)
  )
  select jsonb_build_object(
    'meet_up_existing',   (select c from meetup),
    'cf_headcount',       (select c from cf),
    'activity_headcount', (select c from ah),
    'active_agents',      (select c from aa)
  );
$$;

grant execute on function public.kpi_extended_summary(date, date, bigint[], text) to authenticated;
