-- Phase 1 (#12) — activity drill-down detail rows. Additive (pre-authorized).
--
-- Five activity KPI drill-downs each getAll('activities') (+ users/customers/
-- prospects) on click, then filter client-side: buildCPSDetails,
-- buildMeetingsDetails, buildClientMeetingsDetails, buildMeetUpExistingDetails,
-- buildCFHeadcountDetails. This RPC returns only the period+scope+role activity
-- rows matching a type set (and/or a title pattern), with agent + entity names
-- joined; each builder formats (CFHeadcount groups the CPS rows by customer).
--
-- Type/title filter mirrors the builders:
--   CPS            -> p_types = {CPS}
--   meetings       -> p_types = AGENT_MEETING_TYPES  {EVENT, AGENT_MEETING}
--   client meeting -> p_types = CLIENT_MEETING_TYPES {FTF, FSA}
--   meet-up exist  -> p_types = CLIENT_MEETING_TYPES OR title ILIKE '%golden road%'
--                     (p_title_like already lowercased — matched against lower(title))
-- Entity name = customer.full_name then prospect.full_name (activities has no
-- customer_name/contact_name columns, so the client's extra fallbacks are dead).
-- Scope on lead_agent_id; role on the lead agent's users.role (agent-not-found
-- OR role≠ -> excluded). NULL activity_date kept (parity with the client's
-- `date < from || date > to` which is false on both sides for NULL).

create or replace function public.report_activity_details(
  p_from       date,
  p_to         date,
  p_agent_ids  bigint[] default null,
  p_role       text     default null,
  p_types      text[]   default null,
  p_title_like text     default null
)
returns table (
  activity_date  date,
  activity_type  text,
  activity_title text,
  lead_agent_id  bigint,
  agent_name     text,
  customer_id    bigint,
  entity_name    text
)
language sql
security definer
set search_path = public
as $$
  select
    a.activity_date, a.activity_type, a.activity_title,
    a.lead_agent_id, u.full_name as agent_name,
    a.customer_id,
    coalesce(c.full_name, pr.full_name) as entity_name
  from activities a
  left join users u      on u.id  = a.lead_agent_id
  left join customers c  on c.id  = a.customer_id
  left join prospects pr on pr.id = a.prospect_id
  where (a.activity_date is null or (a.activity_date >= p_from and a.activity_date <= p_to))
    and (
      (p_types is not null and a.activity_type = any(p_types))
      or (p_title_like is not null and lower(coalesce(a.activity_title,'')) like p_title_like)
    )
    and (p_agent_ids is null or a.lead_agent_id = any(p_agent_ids))
    and (p_role is null or p_role = 'All' or u.role = p_role)
  order by a.activity_date desc nulls last;
$$;

grant execute on function public.report_activity_details(date, date, bigint[], text, text[], text) to authenticated;
