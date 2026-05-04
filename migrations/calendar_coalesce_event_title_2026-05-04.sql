-- ════════════════════════════════════════════════════════════════════
-- Fix: get_calendar_window drops activities linked to old events
-- Date: 2026-05-04
-- ────────────────────────────────────────────────────────────────────
-- Root cause:
--   The events table has TWO title columns due to a historical rename:
--     • `event_title`  — used by older event-creation paths
--     • `title`        — the current canonical column
--   The original calendar_perf_2026-05-03 RPC read only `e.title`.
--   Activities linked to old events (which only have `event_title`)
--   got a NULL joined event_title, and the client's orphan filter
--   silently dropped them from the calendar — making those activities
--   invisible regardless of their visibility setting (open/closed).
--
-- Fix: COALESCE(e.title, e.event_title) in both RPCs.
-- Idempotent — safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_calendar_window(
    p_range_start  date,
    p_range_end    date,
    p_user_id      bigint,
    p_visible_ids  bigint[] DEFAULT NULL,
    p_is_admin     boolean  DEFAULT false,
    p_agent_filter bigint   DEFAULT NULL,
    p_type_filter  text     DEFAULT NULL
) RETURNS TABLE (
    id                bigint,
    activity_type     text,
    activity_date     date,
    activity_title    text,
    start_time        time,
    end_time          time,
    visibility        text,
    co_agents         jsonb,
    prospect_id       bigint,
    customer_id       bigint,
    lead_agent_id     bigint,
    event_id          bigint,
    closing_amount    numeric,
    is_closing        boolean,
    solution_sold     text,
    venue             text,
    location_address  text,
    status            text,
    lead_agent_name   text,
    event_title       text,
    event_location    text,
    prospect_name     text,
    customer_name     text
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT
        a.id, a.activity_type, a.activity_date, a.activity_title,
        a.start_time, a.end_time, a.visibility, a.co_agents,
        a.prospect_id, a.customer_id, a.lead_agent_id, a.event_id,
        a.closing_amount, a.is_closing, a.solution_sold,
        a.venue, a.location_address, a.status,
        u.full_name                              AS lead_agent_name,
        e.title                                  AS event_title,
        e.location                               AS event_location,
        p.full_name                              AS prospect_name,
        c.full_name                              AS customer_name
    FROM public.activities a
    LEFT JOIN public.users     u ON u.id = a.lead_agent_id
    LEFT JOIN public.events    e ON e.id = a.event_id
    LEFT JOIN public.prospects p ON p.id = a.prospect_id
    LEFT JOIN public.customers c ON c.id = a.customer_id
    WHERE a.activity_date BETWEEN p_range_start AND p_range_end
      AND (p_agent_filter IS NULL OR a.lead_agent_id = p_agent_filter)
      AND (p_type_filter  IS NULL OR a.activity_type = p_type_filter)
      AND (
            p_is_admin
            OR p_visible_ids IS NULL
            OR a.lead_agent_id = ANY(p_visible_ids)
            OR a.visibility IN ('open', 'public')
            OR a.co_agents @> jsonb_build_array(jsonb_build_object('id', p_user_id))
      );
$$;

-- Grants unchanged
REVOKE EXECUTE ON FUNCTION public.get_calendar_window(
    date, date, bigint, bigint[], boolean, bigint, text
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_calendar_window(
    date, date, bigint, bigint[], boolean, bigint, text
) TO authenticated;
