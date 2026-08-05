-- Fix kpi_extended_summary.cf_headcount — it counted a column the CPS path never writes.
--
-- THE BUG. Both the client getter (getCFHeadcount) and this RPC's `cf` CTE computed
--   count(distinct a.customer_id) ... where a.activity_type = 'CPS'
-- but the CPS create path never writes activities.customer_id. It writes prospect_id
-- (chunks/script-activities.js — the CPS branch sets activity.prospect_id = prospect.id;
-- customer_id is only ever set on the FSA/SITE/FTF branches). Probe on live, 2026-08-05:
--
--   CPS activities total .................. 227
--   ...with a customer_id ................. 0
--
-- So CF Headcount has read 0 for its entire history. It is not a cosmetic card: it
-- auto-fills the boss's weekly Monday report "CF" cell (Section 2) and the quarterly
-- "CF Headcount" target row. Both have been reporting zero.
--
-- THE FIX. A CPS's referrer lives on the CONSULTED PROSPECT, not on the activity:
-- prospects.referred_by_id + referred_by_type. The intake form hard-blocks a save
-- without a referrer ("All appointments must be by recommendation") and its picker
-- offers exactly two kinds of people — 'Prospect' and 'Consultant' (a user at level
-- >= 3). Live: 227/227 CPS rows carry a linked referrer; the only two type values
-- present are 'Consultant' (150 sessions) and 'Prospect' (77).
--
-- CF Headcount is therefore the CLIENT (non-agent) side of that split: distinct
-- non-agent people who referred someone into a CPS. Confirmed with the owner
-- 2026-08-05 over the narrower "only referrers who are customers" reading, which
-- returns 0 for Jul and Aug 2026 because recent referrers have no customer record
-- yet (all-time: 42 client referrers, only 15 with one).
--
-- Type matching is case-insensitive on purpose: the two pickers store 'Prospect' /
-- 'Consultant' capitalised, while the referrals table stores lowercase
-- 'prospect'/'user'/'customer'. Dedup is on (type, id) — a bare id would merge
-- prospect 5 and customer 5, which are two different people.
--
-- NOTE ON THE CLIENT. As of 2026-08-05 the reporting chunk no longer READS
-- cf_headcount from this RPC: calculateKPIs derives CF from getCPSReferrerSplit,
-- which it already computes for the CPS card's referrer chips, so the card, the
-- weekly-report cell and the quarterly row are one number by construction rather
-- than two implementations agreeing. This CTE is fixed anyway so the server-side
-- aggregate is not a wrong-answer landmine for the next caller.
--
-- Idempotent CREATE OR REPLACE. ONLY the `cf` CTE changes — everything before and
-- after it (cutoff / meetup / ah / recent_events / active_ids / aa, the signature
-- and the jsonb_build_object) is carried over byte-identical from
-- kpi_extended_summary_2026-06-14.sql, verified by diff. To roll back, re-run that file.

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
    -- Distinct NON-AGENT referrers behind this period's CPS sessions. The referrer
    -- lives on the CONSULTED prospect, not on the activity. Composite key
    -- (type, id): 'prospect' and 'customer' share the client bucket, so a bare id
    -- would collapse two different people into one head. Type match is
    -- case-insensitive - the pickers store 'Prospect'/'Consultant' capitalised
    -- while the referrals table stores lowercase 'prospect'/'user'/'customer'.
    select count(distinct (
             lower(coalesce(p.referred_by_type,'prospect')),
             p.referred_by_id
           )) c
    from activities a
    join prospects p on p.id = a.prospect_id
    left join users u on u.id = a.lead_agent_id
    where a.activity_type = 'CPS'
      and a.activity_date >= p_from and a.activity_date <= p_to
      and p.referred_by_id is not null
      and lower(coalesce(p.referred_by_type,'')) not in ('consultant','user','agent')
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
