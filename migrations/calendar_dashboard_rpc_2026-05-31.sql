-- ============================================================================
-- calendar_dashboard_payload(agent_id, since, until)  →  jsonb
--
-- Single-RPC replacement for the 4-5 parallel getAll() calls that calendar
-- mount fires today (activities + users + prospects_listing + customers).
-- Returns one JSON envelope server-side, so:
--   - 1 HTTP round-trip instead of 4-5 (matters most on slow mobile networks)
--   - server filters each list BEFORE serialising (no client-side .filter)
--   - one auth + RLS pass amortised across all four datasets
--   - column selection mirrors AppDataStore._lightSelects so payload size is
--     comparable to today's parallel fetches
--
-- Date: 2026-05-31
--
-- RLS: SECURITY INVOKER — runs as the calling user, so every SELECT inside
-- the function still passes through the table's RLS policies. No bypass.
-- ============================================================================

create or replace function public.calendar_dashboard_payload(
    p_agent_id text        default null,
    p_since    timestamptz default (now() - interval '60 days'),
    p_until    timestamptz default (now() + interval '60 days')
)
returns jsonb
language sql
stable
security invoker
as $fn$
    with
    -- Activities: scoped to the requested agent (lead or co-agent) and date window.
    -- Mirrors the columns the calendar's _lightSelects for activities use, plus
    -- nothing more — heavy fields like consultants stay server-side.
    a as (
        select id, activity_type, activity_date, activity_title,
               prospect_id, customer_id, lead_agent_id,
               start_time, end_time, visibility, co_agents, event_id,
               closing_amount, amount_closed, is_closing, solution_sold,
               location_address, venue, status, unable_to_serve, unable_reason,
               note_key_points, note_outcome, note_next_steps,
               source, created_at, updated_at, score_value, is_closed,
               next_action, next_action_done, completed_at, photo_urls,
               opportunity_potential
          from public.activities
         where activity_date between p_since and p_until
           and (
                p_agent_id is null
                or lead_agent_id::text = p_agent_id
                or visibility in ('open','public')
                or (co_agents ? p_agent_id)
           )
    ),
    -- Users: hierarchy + display fields. ~75 rows for this CRM — full set always.
    u as (
        select id, full_name, email, phone, role, status, team_id,
               reporting_to, date_of_birth, created_at, updated_at
          from public.users
         where status is null or status <> 'deleted'
    ),
    -- Prospects: lean listing select. Filtered to active rows the agent owns
    -- (or can see via policy) — keeps payload small even on 30K-row tables.
    p as (
        select id, full_name, nickname, phone, email, ming_gua, score,
               occupation, company_name, responsible_agent_id, status,
               conversion_status, last_activity_date, protection_deadline,
               manual_grade, tags
          from public.prospects
         where (status is null or status not in ('closed_lost','archived'))
           and (
                p_agent_id is null
                or responsible_agent_id::text = p_agent_id
                or cps_agent_id::text = p_agent_id
                or lead_agent_id::text = p_agent_id
           )
         order by last_activity_date desc nulls last
         limit 1000
    ),
    -- Customers: scoped to the agent. Similar lean column set.
    c as (
        select id, full_name, phone, email, responsible_agent_id, status,
               created_at, updated_at
          from public.customers
         where (
                p_agent_id is null
                or responsible_agent_id::text = p_agent_id
           )
         order by updated_at desc nulls last
         limit 500
    )
    select jsonb_build_object(
        'activities', coalesce((select jsonb_agg(to_jsonb(a)) from a), '[]'::jsonb),
        'users',      coalesce((select jsonb_agg(to_jsonb(u)) from u), '[]'::jsonb),
        'prospects',  coalesce((select jsonb_agg(to_jsonb(p)) from p), '[]'::jsonb),
        'customers',  coalesce((select jsonb_agg(to_jsonb(c)) from c), '[]'::jsonb),
        'served_at',  now()
    );
$fn$;

grant execute on function public.calendar_dashboard_payload(text, timestamptz, timestamptz) to authenticated;

-- Client-side call pattern (AppDataStore wrapper):
--   const { data } = await supabase.rpc('calendar_dashboard_payload', {
--       p_agent_id: currentUserId,
--       p_since:    new Date(Date.now() - 60*86400*1000).toISOString(),
--       p_until:    new Date(Date.now() + 60*86400*1000).toISOString(),
--   });
--   // data = { activities: [...], users: [...], prospects: [...], customers: [...], served_at }
--
-- The client then primes each table's in-memory cache + localStorage snapshot
-- with the returned arrays so subsequent code that calls getAll('activities')
-- etc. hits the cache instead of firing another HTTP round-trip.
