-- =====================================================================
-- kpi_role_level_fallback_2026-07-14.sql
-- ✅ APPLIED to live remuwhxvzkzjtgbzqjaa 2026-07-14 (Management API).
--
-- Follow-on to rls_current_user_level_fallback_2026-07-13.sql. Two reporting
-- RPCs classified "new agents" with an inline regex
--     u.role ~ 'Level[[:space:]]*([3-9]|1[0-2])([^0-9]|$)'
-- which — like the old current_user_level() — has NO fallback for Chinese-only
-- role names, so an agent whose role is 传福大使 (client _getUserLevel / server
-- _role_to_level both map this to Level 12, i.e. inside the isAgent L3-12 band)
-- was silently EXCLUDED from the new-agent counts. SQL and client disagreed.
--
-- FIX: swap the inline regex for the canonical server mirror
--     public._role_to_level(u.role) between 3 and 12
-- (isAgent semantics), so the two agree. Verified behaviour-preserving against
-- live data: every 'Level N ...' role classifies identically old-vs-new; only
-- 传福大使 (mapped_level 12) flips false->true — the one intended inclusion.
-- There are no snake_case roles in the data, so no other classification moves.
--
-- NOT changed: queue_action_plan_reminders still uses `role ~ 'Level\s*[3-6]'`
-- plus ilike text roles — that is a DELIBERATE narrower target band (a reminder-
-- scope decision), not an isAgent check, so extending it to Chinese roles is a
-- business decision, not a parse-consistency fix. Left for the owner.
--
-- Bodies below are the exact live definitions with only the one clause changed
-- per function (kpi_user_summary keeps its accurate "Level 3..12" COMMENT).
-- Additive (CREATE OR REPLACE); pre-authorized.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.kpi_target_comparison(p_from date, p_to date, p_agent_ids bigint[] DEFAULT NULL::bigint[], p_role text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    WITH act AS (
        SELECT a.activity_type
        FROM public.activities a
        LEFT JOIN public.users u ON u.id = a.lead_agent_id
        WHERE a.activity_date BETWEEN p_from AND p_to
          AND (public.report_scope_ids(p_agent_ids) IS NULL OR a.lead_agent_id = ANY(public.report_scope_ids(p_agent_ids)))
          AND (p_role IS NULL OR p_role = 'All' OR u.role = p_role)
    ),
    pur AS (
        SELECT p.amount, p.payment_method, p.is_agent_package
        FROM public.purchases p
        LEFT JOIN public.customers c ON c.id = p.customer_id
        LEFT JOIN public.users u ON u.id = c.responsible_agent_id
        WHERE p.date BETWEEN p_from AND p_to
          AND (public.report_scope_ids(p_agent_ids) IS NULL OR c.responsible_agent_id = ANY(public.report_scope_ids(p_agent_ids)))
          AND (p_role IS NULL OR p_role = 'All' OR u.role = p_role)
    )
    SELECT jsonb_build_object(
        'cps_count',     (SELECT COUNT(*) FROM act WHERE activity_type = 'CPS'),
        'total_meetings',(SELECT COUNT(*) FROM act WHERE activity_type IN ('EVENT','AGENT_MEETING')),
        'total_sales',   (SELECT COALESCE(SUM(amount),0) FROM pur WHERE COALESCE(is_agent_package,false) = false),
        'pop_count',     (SELECT COUNT(*) FROM pur WHERE payment_method = 'POP'),
        'pop_sales',     (SELECT COALESCE(SUM(amount),0) FROM pur WHERE payment_method = 'POP'),
        'epp_count',     (SELECT COUNT(*) FROM pur WHERE payment_method = 'EPP'),
        'epp_sales',     (SELECT COALESCE(SUM(amount),0) FROM pur WHERE payment_method = 'EPP'),
        'new_agents', (
            SELECT COUNT(*)
            FROM public.users u
            WHERE u.join_date BETWEEN p_from AND p_to
              AND (public.report_scope_ids(p_agent_ids) IS NULL OR u.id = ANY(public.report_scope_ids(p_agent_ids)))
              AND (p_role IS NULL OR p_role = 'All' OR u.role = p_role)
              AND (
                  (p_role IS NOT NULL AND p_role <> 'All')
                  OR public._role_to_level(u.role) between 3 and 12
              )
        ),
        'new_customers', (
            SELECT COUNT(*)
            FROM public.customers c
            WHERE c.customer_since BETWEEN p_from AND p_to
              AND (public.report_scope_ids(p_agent_ids) IS NULL OR c.responsible_agent_id = ANY(public.report_scope_ids(p_agent_ids)))
              AND EXISTS (
                  SELECT 1 FROM public.purchases p
                  WHERE p.customer_id = c.id
                    AND p.date BETWEEN p_from AND p_to
              )
        )
    );
$function$;

CREATE OR REPLACE FUNCTION public.kpi_user_summary(p_from date, p_to date, p_agent_ids bigint[] DEFAULT NULL::bigint[], p_role text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
    SELECT jsonb_build_object(
        'new_agents', (
            SELECT COUNT(*)
            FROM public.users u
            WHERE u.join_date BETWEEN p_from AND p_to
              AND (public.report_scope_ids(p_agent_ids) IS NULL OR u.id = ANY(public.report_scope_ids(p_agent_ids)))
              AND (
                  p_role IS NULL
                  OR p_role = 'All'
                  OR u.role = p_role
              )
              AND (
                  (p_role IS NOT NULL AND p_role <> 'All')
                  -- isAgent semantics: Level 3 through Level 12 inclusive
                  OR public._role_to_level(u.role) between 3 and 12
              )
        ),
        'new_customers', (
            SELECT COUNT(*)
            FROM public.customers c
            WHERE c.customer_since BETWEEN p_from AND p_to
              AND (public.report_scope_ids(p_agent_ids) IS NULL OR c.responsible_agent_id = ANY(public.report_scope_ids(p_agent_ids)))
              AND EXISTS (
                  SELECT 1 FROM public.purchases p
                  WHERE p.customer_id = c.id
                    AND p.date BETWEEN p_from AND p_to
              )
        )
    );
$function$;
