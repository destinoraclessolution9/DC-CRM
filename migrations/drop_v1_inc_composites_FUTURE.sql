-- ============================================================================
-- Drop the v1 INCLUDE indexes + original non-INCLUDE composites
-- Date: 2026-06-01 (created); APPLY DATE: TBD (see prerequisites below)
-- Status: FILE ONLY — DO NOT APPLY until observation criteria are met.
-- ----------------------------------------------------------------------------
-- Filename note: ends in _FUTURE to signal this is intentionally deferred.
-- Rename to drop_v1_inc_composites_<date>.sql when applying.
--
-- This migration retires THREE generations of indexes that all serve the
-- same query patterns, once the latest generation (_inc2 from 2026-06-01)
-- is observed to be the planner's choice:
--
--   Original (non-INCLUDE)           → idx_prospects_agent_created
--   v1 INCLUDE without id            → idx_prospects_agent_created_inc
--   v2 INCLUDE with id (current)    → idx_prospects_agent_created_inc2  ← keep
--
-- Why both v1 and original need dropping:
--   The original composite was kept after v1 landed (per safety note in
--   include_columns_2026-05-31.sql). Once v2 is verified, neither v1 nor
--   the original add any value — only write amplification.
--
-- ============================================================================
-- PREREQUISITES — all must be true before applying:
-- ============================================================================
--
-- 1. include_columns_refine_2026-06-01.sql has been applied AND verified
--    via EXPLAIN ANALYZE showing the _inc2 indexes in the plan with
--    `Heap Fetches: 0`.
--
-- 2. At least 7 days of production traffic has flowed through the new
--    indexes — verify via:
--
--      SELECT indexrelname, idx_scan, idx_tup_read, idx_tup_fetch
--      FROM pg_stat_user_indexes
--      WHERE schemaname = 'public'
--        AND indexrelname IN (
--          'idx_prospects_agent_created',     'idx_prospects_agent_created_inc',     'idx_prospects_agent_created_inc2',
--          'idx_customers_agent_created',     'idx_customers_agent_created_inc',     'idx_customers_agent_created_inc2',
--          'idx_activities_prospect_date',    'idx_activities_prospect_date_inc',    'idx_activities_prospect_date_inc2',
--          'idx_activities_customer_date',    'idx_activities_customer_date_inc',    'idx_activities_customer_date_inc2'
--        )
--      ORDER BY indexrelname;
--
--      The _inc2 rows should show idx_scan > 0 (planner is picking them).
--      The original + _inc rows should show idx_scan ≈ 0 (unused).
--
-- 3. If any _inc2 index shows idx_scan = 0, investigate WHY before dropping
--    the older variants. Possible causes:
--      - Visibility map stale → run VACUUM ANALYZE <tablename>
--      - Planner cost estimate prefers heap scan at current size → wait for
--        more data, or tweak STATISTICS target on the leading column
--      - The query shape doesn't match what's covered → check actual
--        SELECT/WHERE/ORDER BY in the slow logs
--
-- ============================================================================
-- The drops
-- ============================================================================
-- Each DROP is CONCURRENTLY → no exclusive lock, but cannot run inside a
-- transaction. Paste one per Supabase editor run.

-- Drop the v1 INCLUDE variants (the ones with no id in INCLUDE):
DROP INDEX CONCURRENTLY IF EXISTS public.idx_prospects_agent_created_inc;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_customers_agent_created_inc;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_activities_prospect_date_inc;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_activities_customer_date_inc;

-- Drop the original non-INCLUDE composites:
DROP INDEX CONCURRENTLY IF EXISTS public.idx_prospects_agent_created;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_customers_agent_created;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_activities_prospect_date;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_activities_customer_date;

-- ============================================================================
-- Verification after drop
-- ============================================================================
-- Confirm only the _inc2 variants remain:
--
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname = 'public'
--     AND indexname LIKE 'idx_prospects_agent_created%'
--      OR indexname LIKE 'idx_customers_agent_created%'
--      OR indexname LIKE 'idx_activities_prospect_date%'
--      OR indexname LIKE 'idx_activities_customer_date%'
--   ORDER BY indexname;
--   -- Expect: 4 rows, all ending in _inc2
--
-- Run EXPLAIN ANALYZE on the same query as the include_columns_refine
-- verification — it should still show Index Only Scan with no
-- performance regression.
