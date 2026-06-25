-- ════════════════════════════════════════════════════════════════════
-- HOTFIX — restore EXECUTE grant on the calendar RPCs
-- Date: 2026-06-25
-- ────────────────────────────────────────────────────────────────────
-- Symptom (LIVE, verified 2026-06-25):
--   Desktop calendar grid stuck on shimmer skeletons; "Today at a Glance"
--   reads 0. Mobile calendar loads fine.
--
-- Root cause (verified by calling the RPCs from an authenticated session
-- against the live DB):
--   get_calendar_window     -> ERROR 42501 "permission denied for function"
--   get_calendar_hot_details-> ERROR 42501 "permission denied for function"
--   direct SELECT on activities (the mobile / queryAdvanced path) -> OK
--
--   The authenticated role lost EXECUTE on BOTH calendar functions. The
--   desktop calendar is the only surface that calls these RPCs, so only it
--   broke. In script-calendar.js the 42501 is a non-network server error:
--   it toasts and returns WITHOUT painting, leaving the skeleton grid.
--   Mobile / legacy fetch via queryAdvanced('activities') (direct table,
--   RLS-scoped) is unaffected — hence mobile still renders.
--
--   Likely trigger: a prior dashboard-applied migration (chunked / non-
--   atomic) recreated/hardened these functions but the trailing GRANT did
--   not land, while a REVOKE ... FROM public removed the default PUBLIC
--   execute they had been relying on.
--
-- Fix: (re-)grant EXECUTE to authenticated on both functions, by exact
--   signature, and reload the PostgREST schema cache.
--
-- Safe / idempotent — re-running only re-asserts the grant.
-- ════════════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION public.get_calendar_window(
    date, date, bigint, bigint[], boolean, bigint, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_calendar_hot_details(
    date, date, bigint, bigint[], boolean
) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Verify (optional) — should list 'authenticated' as a grantee for each:
--   SELECT p.proname, r.rolname
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   CROSS JOIN LATERAL aclexplode(p.proacl) a
--   JOIN pg_roles r ON r.oid = a.grantee
--   WHERE n.nspname='public'
--     AND p.proname IN ('get_calendar_window','get_calendar_hot_details')
--     AND a.privilege_type='EXECUTE';
