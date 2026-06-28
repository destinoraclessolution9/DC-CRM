-- ════════════════════════════════════════════════════════════════════
-- Feature: "Own Team" activity visibility (visibility = 'team')
-- Date: 2026-06-28
-- ────────────────────────────────────────────────────────────────────
-- Adds a third visibility tier between 'closed' (owner-chain only) and
-- 'open' (every agent). A 'team' activity is visible to the owner's
-- vertical reporting chain: the owner, anyone the owner reports up to,
-- and the owner's whole downline (everyone reporting up to the owner,
-- transitively) — plus co-agents and admin/marketing as always.
--
-- Hierarchy source = users.reporting_to (team_id is currently unused/NULL
-- across the org, so we key off the reporting tree, not team_id).
--
-- Two layers must agree because the calendar RPCs are SECURITY INVOKER:
--   1. the activities_scoped_select RLS policy (row gate), and
--   2. each RPC's own WHERE filter.
-- Additive + reversible. Rollback notes at the bottom.
-- ════════════════════════════════════════════════════════════════════

-- ── Hierarchy helpers (SECURITY DEFINER so the recursive walk sees the
--    full users tree regardless of the caller's row-level scope) ──────
CREATE OR REPLACE FUNCTION public.is_anc_or_self(p_node bigint, p_anc bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE up AS (
    SELECT id, reporting_to FROM users WHERE id = p_node
    UNION                                  -- UNION (not ALL) → cycle-safe
    SELECT u.id, u.reporting_to FROM users u JOIN up ON u.id = up.reporting_to
  )
  SELECT EXISTS (SELECT 1 FROM up WHERE id = p_anc);
$$;

-- True when p_a and p_b sit in the same vertical reporting chain (one is
-- an ancestor-or-self of the other), i.e. they're on the same "team".
CREATE OR REPLACE FUNCTION public.same_team_chain(p_a bigint, p_b bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_a IS NOT NULL AND p_b IS NOT NULL AND (
           p_a = p_b
           OR public.is_anc_or_self(p_a, p_b)
           OR public.is_anc_or_self(p_b, p_a)
         );
$$;

GRANT EXECUTE ON FUNCTION public.is_anc_or_self(bigint, bigint)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.same_team_chain(bigint, bigint)  TO authenticated, service_role;

-- ── 1. RLS row gate (ALTER POLICY = no drop/create gap) ──────────────
ALTER POLICY "activities_scoped_select" ON public.activities USING (
  lead_agent_id IN (SELECT current_user_visible_ids())
  OR lead_agent_id = current_user_row_id()
  OR co_agents @> jsonb_build_array(jsonb_build_object('id', current_user_row_id()))
  OR visibility IN ('open', 'public')
  OR (visibility = 'team' AND public.same_team_chain(current_user_row_id(), lead_agent_id))
  OR (lead_agent_id IS NULL AND COALESCE(current_user_level(), 99) <= 2)
);

-- ── 2. get_calendar_window (desktop grid) ────────────────────────────
CREATE OR REPLACE FUNCTION public.get_calendar_window(p_range_start date, p_range_end date, p_user_id bigint, p_visible_ids bigint[] DEFAULT NULL::bigint[], p_is_admin boolean DEFAULT false, p_agent_filter bigint DEFAULT NULL::bigint, p_type_filter text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, activity_type text, activity_date date, activity_title text, start_time time without time zone, end_time time without time zone, visibility text, co_agents jsonb, prospect_id bigint, customer_id bigint, lead_agent_id bigint, event_id bigint, closing_amount numeric, is_closing boolean, solution_sold text, venue text, location_address text, status text, lead_agent_name text, event_title text, event_location text, prospect_name text, customer_name text)
 LANGUAGE sql STABLE
AS $function$
    SELECT
        a.id, a.activity_type, a.activity_date, a.activity_title,
        a.start_time, a.end_time, a.visibility, a.co_agents,
        a.prospect_id, a.customer_id, a.lead_agent_id, a.event_id,
        a.closing_amount, a.is_closing, a.solution_sold,
        a.venue, a.location_address, a.status,
        u.full_name                                              AS lead_agent_name,
        e.title                                                  AS event_title,
        e.location                                               AS event_location,
        CASE WHEN (
                p_is_admin
                OR a.lead_agent_id = p_user_id
                OR (p_visible_ids IS NOT NULL AND a.lead_agent_id = ANY(p_visible_ids))
                OR a.co_agents @> jsonb_build_array(jsonb_build_object('id', p_user_id))
             ) THEN p.full_name ELSE NULL END                    AS prospect_name,
        CASE WHEN (
                p_is_admin
                OR a.lead_agent_id = p_user_id
                OR (p_visible_ids IS NOT NULL AND a.lead_agent_id = ANY(p_visible_ids))
                OR a.co_agents @> jsonb_build_array(jsonb_build_object('id', p_user_id))
             ) THEN c.full_name ELSE NULL END                    AS customer_name
    FROM public.activities a
    LEFT JOIN public.users     u ON u.id = a.lead_agent_id
    LEFT JOIN public.events    e ON e.id = a.event_id
    LEFT JOIN public.prospects p ON p.id = a.prospect_id
    LEFT JOIN public.customers c ON c.id = a.customer_id
    WHERE a.activity_date BETWEEN p_range_start AND p_range_end
      AND a.source IS DISTINCT FROM 'birthday_auto'
      AND (p_agent_filter IS NULL OR a.lead_agent_id = p_agent_filter)
      AND (p_type_filter  IS NULL OR a.activity_type = p_type_filter)
      AND (
            p_is_admin
            OR p_visible_ids IS NULL
            OR a.lead_agent_id = ANY(p_visible_ids)
            OR a.visibility IN ('open', 'public')
            OR (a.visibility = 'team' AND public.same_team_chain(p_user_id, a.lead_agent_id))
            OR a.co_agents @> jsonb_build_array(jsonb_build_object('id', p_user_id))
      );
$function$;

-- ── 3. get_calendar_hot_details (detail-modal warm cache) ────────────
CREATE OR REPLACE FUNCTION public.get_calendar_hot_details(p_range_start date, p_range_end date, p_user_id bigint, p_visible_ids bigint[] DEFAULT NULL::bigint[], p_is_admin boolean DEFAULT false)
 RETURNS SETOF activities
 LANGUAGE sql STABLE
AS $function$
    SELECT a.*
      FROM public.activities a
     WHERE a.activity_date BETWEEN p_range_start AND p_range_end
       AND (
             p_is_admin
             OR p_visible_ids IS NULL
             OR a.lead_agent_id = ANY(p_visible_ids)
             OR a.visibility IN ('open', 'public')
             OR (a.visibility = 'team' AND public.same_team_chain(p_user_id, a.lead_agent_id))
             OR a.co_agents @> jsonb_build_array(jsonb_build_object('id', p_user_id))
       );
$function$;

-- ── 4. calendar_dashboard_payload (60-day dashboard bundle) ──────────
CREATE OR REPLACE FUNCTION public.calendar_dashboard_payload(p_agent_id text DEFAULT NULL::text, p_since timestamp with time zone DEFAULT (now() - '60 days'::interval), p_until timestamp with time zone DEFAULT (now() + '60 days'::interval))
 RETURNS jsonb
 LANGUAGE sql STABLE
AS $function$
    with
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
                or (visibility = 'team' and p_agent_id is not null
                    and public.same_team_chain(p_agent_id::bigint, lead_agent_id))
           )
    ),
    u as (
        select id, full_name, email, phone, role, status, team_id,
               reporting_to, date_of_birth, created_at, updated_at
          from public.users
         where status is null or status <> 'deleted'
    ),
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
$function$;

-- ── Rollback (if ever needed) ────────────────────────────────────────
-- Remove the `OR (visibility = 'team' ...)` line from the policy + the
-- three functions (re-run their prior bodies), then:
--   DROP FUNCTION IF EXISTS public.same_team_chain(bigint,bigint);
--   DROP FUNCTION IF EXISTS public.is_anc_or_self(bigint,bigint);
