-- ════════════════════════════════════════════════════════════════════
-- Calendar fix — hide auto-logged birthday touches from the grid
-- Date: 2026-06-24
-- ────────────────────────────────────────────────────────────────────
-- Problem:
--   Birthday "Send Wish" / "Prepare Gift" / mobile birthday-WhatsApp taps
--   log a touch as an activity with activity_type='CALL', source='birthday_auto'
--   and NO start_time. These are meant to live in the person's history only —
--   the client carries a guard, _isAutoTouchLog(a) === (a.source==='birthday_auto'),
--   to keep them off the calendar.
--
--   But the desktop calendar grid is fed by get_calendar_window, whose
--   RETURNS TABLE never included the `source` column. So a.source was always
--   undefined on the grid rows, the client guard never matched, and every
--   birthday touch leaked onto the calendar — rendering as a "00:00 … CALL"
--   card (00:00 because there is no start_time). Repeated taps (gift logging
--   has no per-day dedup) produced several identical 00:00 cards per person.
--
--   The mobile calendar and the desktop legacy-fallback path both fetch via
--   queryAdvanced('activities'), whose light-select DOES include `source`, so
--   their client-side `source !== 'birthday_auto'` filters already work. Only
--   the RPC path leaked.
--
-- Fix:
--   Exclude source='birthday_auto' rows server-side in get_calendar_window,
--   so the touch-logs never reach any calendar surface. IS DISTINCT FROM keeps
--   NULL-source and all other rows (NULL IS DISTINCT FROM 'birthday_auto' = true).
--   Touch-logs remain in the person's activity history (that view uses a
--   different query, getActivitiesForProspect/Customer / getById).
--
--   This is the ONLY change vs. the 2026-06-11 calendar-privacy definition
--   (the CASE-gated client-name privacy is preserved verbatim). Return type
--   and signature are unchanged → plain CREATE OR REPLACE, grants preserved.
--
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
        u.full_name                                              AS lead_agent_name,
        e.title                                                  AS event_title,
        e.location                                               AS event_location,
        -- Client names are private to the activity owner / co-agents / admins.
        -- Public visibility makes the tile visible; it does NOT grant access
        -- to the linked prospect or customer identity.
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
      -- NEW (2026-06-24): auto-logged birthday touches are history-only, never
      -- on the calendar. Keeps NULL-source + every other row.
      AND a.source IS DISTINCT FROM 'birthday_auto'
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

-- Preserve existing grants (unchanged signature → grants survive CREATE OR
-- REPLACE; re-stated here so the migration is self-contained / re-runnable).
REVOKE EXECUTE ON FUNCTION public.get_calendar_window(
    date, date, bigint, bigint[], boolean, bigint, text
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_calendar_window(
    date, date, bigint, bigint[], boolean, bigint, text
) TO authenticated;

NOTIFY pgrst, 'reload schema';
