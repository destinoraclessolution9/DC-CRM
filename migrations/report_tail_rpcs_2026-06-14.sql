-- Phase 1 (#12) — remaining reporting drill-down RPCs. Additive (pre-authorized).
-- Serves buildNewCustomersDetails, buildConversionDetails, buildActiveAgentsDetails,
-- buildActivityHeadcountDetails. All scope-only (no role filter — the client
-- builders don't apply _currentRoleFilter to these). Date parity matches each
-- client builder EXACTLY (see per-function notes).

-- (1) New customers in [from,to]. customer_since is a DATE → inclusive of `to`
--     (client `customer_since > to` is false when equal). Scope on
--     responsible_agent_id; agent name joined. NOTE: customers has no `source`
--     column, so the client's Source cell already always rendered '—'; we return
--     null::text to preserve that exactly.
create or replace function public.report_new_customers(
  p_from date, p_to date, p_agent_ids bigint[] default null
)
returns table (customer_since date, full_name text, agent_name text, source text)
language sql security definer set search_path = public
as $$
  select c.customer_since, c.full_name, u.full_name as agent_name, null::text as source
  from customers c
  left join users u on u.id = c.responsible_agent_id
  where c.customer_since >= p_from and c.customer_since <= p_to
    and (p_agent_ids is null or c.responsible_agent_id = any(p_agent_ids))
  order by c.customer_since desc nulls last;
$$;

-- (2) New prospects in [from,to). created_at is TIMESTAMPTZ; the client string-
--     compares `created_at < from || created_at > to`, which INCLUDES the whole
--     `from` day but EXCLUDES the `to` day (a timestamp on the to-day sorts
--     after the bare 'YYYY-MM-DD' string). Replicate with >= from::date AND
--     < to::date. Scope on responsible_agent_id; agent name + status joined.
create or replace function public.report_new_prospects(
  p_from date, p_to date, p_agent_ids bigint[] default null
)
returns table (created_at timestamptz, full_name text, agent_name text, status text)
language sql security definer set search_path = public
as $$
  select p.created_at, p.full_name, u.full_name as agent_name, p.status
  from prospects p
  left join users u on u.id = p.responsible_agent_id
  where p.created_at >= p_from::timestamptz and p.created_at < p_to::timestamptz
    and (p_agent_ids is null or p.responsible_agent_id = any(p_agent_ids))
  order by p.created_at desc;
$$;

-- (3) Per-agent last activity within the rolling 60-day window (KL tz, matching
--     the active_agents KPI). last_date = max lead activity_date in window, OR
--     the cutoff date if the agent only appears via recent event attendance
--     (mirrors the client: event attendance sets cutoff only when no activity
--     date exists). Scope on agent id. isAgent band stays client-side.
create or replace function public.agent_last_activity_60d(
  p_agent_ids bigint[] default null
)
returns table (agent_id bigint, last_date date)
language sql security definer set search_path = public
as $$
  with cutoff as (select ((now() at time zone 'Asia/Kuala_Lumpur')::date - 60) d),
  recent_events as (
    select distinct a.event_id from activities a, cutoff
    where a.activity_type = 'EVENT' and a.event_id is not null and a.activity_date >= cutoff.d
  ),
  act as (
    select a.lead_agent_id aid, max(a.activity_date) ld
    from activities a, cutoff
    where a.lead_agent_id is not null and a.activity_date >= cutoff.d
    group by a.lead_agent_id
  ),
  evt as (
    select distinct ea.entity_id aid
    from event_attendees ea
    where ea.attendee_type = 'agent' and ea.entity_id is not null
      and ea.event_id in (select event_id from recent_events)
  ),
  merged as (
    select coalesce(a.aid, e.aid) aid, coalesce(a.ld, (select d from cutoff)) ld
    from act a full outer join evt e on e.aid = a.aid
  )
  select aid, ld from merged
  where p_agent_ids is null or aid = any(p_agent_ids);
$$;

-- (4) Attended event-attendee detail rows in [from,to] (activity_date is a DATE
--     → inclusive; null date excluded, matching the client's `'' < from`).
--     Scope resolves the agent from the attendee (agent → entity_id; customer →
--     customer.responsible_agent_id; else prospect.responsible_agent_id). Display
--     name = the entity's name with the stored entity_name as fallback. Event
--     title = events.title (events has no event_title column) else 'Event #id'.
create or replace function public.report_activity_headcount_details(
  p_from date, p_to date, p_agent_ids bigint[] default null
)
returns table (
  activity_date date, event_title text, attendee_type text,
  display_name text, is_agent boolean
)
language sql security definer set search_path = public
as $$
  select
    act.activity_date,
    coalesce(e.title, 'Event #' || att.event_id::text) as event_title,
    att.attendee_type,
    case
      when att.attendee_type = 'agent'    then coalesce(u_ent.full_name, att.entity_name, '—')
      when att.attendee_type = 'customer' then coalesce(c_ent.full_name, att.entity_name, '—')
      else coalesce(p_ent.full_name, att.entity_name, '—')
    end as display_name,
    (att.attendee_type = 'agent') as is_agent
  from event_attendees att
  join activities act on act.id = att.activity_id
  left join events e       on e.id = att.event_id
  left join users u_ent    on att.attendee_type = 'agent'    and u_ent.id = coalesce(att.entity_id, att.attendee_id)
  left join customers c_ent on att.attendee_type = 'customer' and c_ent.id = coalesce(att.entity_id, att.attendee_id)
  left join prospects p_ent on att.attendee_type not in ('agent','customer') and p_ent.id = coalesce(att.entity_id, att.attendee_id)
  where (att.attended is true or att.attendance_status = 'Attended')
    and act.activity_date >= p_from and act.activity_date <= p_to
    and (
      p_agent_ids is null
      or (case
            when att.attendee_type = 'agent'    then coalesce(att.entity_id, att.attendee_id)
            when att.attendee_type = 'customer' then c_ent.responsible_agent_id
            else p_ent.responsible_agent_id
          end) = any(p_agent_ids)
    )
  order by act.activity_date desc;
$$;

grant execute on function public.report_new_customers(date, date, bigint[]) to authenticated;
grant execute on function public.report_new_prospects(date, date, bigint[]) to authenticated;
grant execute on function public.agent_last_activity_60d(bigint[]) to authenticated;
grant execute on function public.report_activity_headcount_details(date, date, bigint[]) to authenticated;
