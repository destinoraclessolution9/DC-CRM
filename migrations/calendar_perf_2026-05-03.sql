-- ════════════════════════════════════════════════════════════════════
-- Calendar performance overhaul — 2026-05-03
-- ────────────────────────────────────────────────────────────────────
-- Replaces the 6 round-trips per renderCalendar() with 2 parallel RPCs:
--   1. get_calendar_window: light columns + JOIN'd display names for the
--      whole visible month (drives the visible grid; ~80–150 KB instead
--      of 1–2 MB per render)
--   2. get_calendar_hot_details: full activity rows for yesterday →
--      today + 7 days (warms a client cache so taps on near-term cards
--      open the detail modal instantly)
--
-- Indexes:
--   - GIN on co_agents JSONB so the @> filter no longer scans the table
--   - Partial index on (visibility, activity_date) for the public/open
--     leg of the OR scope.
--
-- All idempotent (CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE).
-- ════════════════════════════════════════════════════════════════════

-- ───────────── Indexes ─────────────
CREATE INDEX IF NOT EXISTS idx_activities_co_agents_gin
    ON public.activities USING gin (co_agents);

CREATE INDEX IF NOT EXISTS idx_activities_visibility_date
    ON public.activities (visibility, activity_date)
    WHERE visibility IN ('open', 'public');


-- ───────────── Light RPC (drives the visible grid) ─────────────
-- Returns one row per activity in the date range, with JOIN'd display
-- names so the client doesn't need to load entire users / events /
-- prospects / customers tables to render cards. Excludes heavy
-- text/JSONB columns (notes, photo_urls, cps_invitation_details, etc.)
-- which are loaded on click via get_calendar_hot_details / getById.
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
    -- joined display fields (saves the 4 separate getAll() calls)
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
        u.full_name                          AS lead_agent_name,
        e.title                              AS event_title,
        e.location                           AS event_location,
        p.full_name                          AS prospect_name,
        c.full_name                          AS customer_name
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


-- ───────────── Hot-window RPC (warms detail cache) ─────────────
-- Returns full activity rows for the hot window so click-to-open is
-- instant. Skips agent/type filters intentionally — toggling them in
-- the UI shouldn't invalidate the cache, since the cache key is the
-- activity id, not the filter.
CREATE OR REPLACE FUNCTION public.get_calendar_hot_details(
    p_range_start date,
    p_range_end   date,
    p_user_id     bigint,
    p_visible_ids bigint[] DEFAULT NULL,
    p_is_admin    boolean  DEFAULT false
) RETURNS SETOF public.activities
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT a.*
      FROM public.activities a
     WHERE a.activity_date BETWEEN p_range_start AND p_range_end
       AND (
             p_is_admin
             OR p_visible_ids IS NULL
             OR a.lead_agent_id = ANY(p_visible_ids)
             OR a.visibility IN ('open', 'public')
             OR a.co_agents @> jsonb_build_array(jsonb_build_object('id', p_user_id))
       );
$$;


-- ───────────── Grants ─────────────
GRANT EXECUTE ON FUNCTION public.get_calendar_window(
    date, date, bigint, bigint[], boolean, bigint, text
) TO authenticated, anon;

GRANT EXECUTE ON FUNCTION public.get_calendar_hot_details(
    date, date, bigint, bigint[], boolean
) TO authenticated, anon;
