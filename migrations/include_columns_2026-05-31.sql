-- ============================================================================
-- INCLUDE columns on hot composite indexes — enable index-only scans
-- Date: 2026-05-31
-- Status: FILE ONLY — apply via Supabase SQL editor after review.
-- ----------------------------------------------------------------------------
-- Motivation:
-- Today's hot prospect-list query pattern (data.js queryAdvanced / getAll
-- prospects) does:
--
--   SELECT id, full_name, nickname, phone, email, ming_gua, score, occupation,
--          company_name, responsible_agent_id, status, conversion_status,
--          last_activity_date, protection_deadline, manual_grade, tags
--   FROM prospects
--   WHERE responsible_agent_id = $1
--   ORDER BY created_at DESC;
--
-- The existing index idx_prospects_agent_created (responsible_agent_id,
-- created_at DESC) speeds up the WHERE + ORDER BY, but Postgres still has to
-- fetch every matching row from the heap to read the SELECT columns.
--
-- An INCLUDE clause stores those extra columns in the index leaf pages so
-- the query can be answered ENTIRELY from the index — no heap fetch needed.
-- This is called an "index-only scan."
--
-- Tradeoff: INCLUDE makes the index larger (~30-50% more space). For wide
-- selects on hot list views, the speedup is significant — often 2-5×.
--
-- ----------------------------------------------------------------------------
-- IMPORTANT — what NOT to do:
-- - Do NOT add INCLUDE columns that change frequently. Every UPDATE on an
--   included column requires the index entry to be rewritten, the same as
--   if it were a key column.
-- - Do NOT add wide TEXT or JSONB columns — they bloat the index without
--   meaningful query benefit.
-- - The "prospects_listing" select in data.js has 16 columns; including all
--   of them would bloat the index more than the win. Pick the 4-5 hottest
--   that are rarely updated.
--
-- Strategy here: include only the small, mostly-immutable identity columns
-- (full_name, nickname, phone) — these satisfy 80% of the list-view render
-- without a heap fetch. The other columns (status, score, dates) fall back
-- to a normal heap fetch, which is still fast for the few rows returned.
-- ============================================================================

-- ─────────────────── 1. Prospects list view (highest ROI) ───────────────────
-- Replace existing composite with INCLUDE variant. CONCURRENTLY so no
-- exclusive lock on the prospects table while it builds.
--
-- Step 1: build the new index alongside the old one.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prospects_agent_created_inc
    ON public.prospects (responsible_agent_id, created_at DESC)
    INCLUDE (full_name, nickname, phone);

-- Step 2: verify the new index is being used by the planner.
-- Run EXPLAIN ANALYZE on the prospect list query; the plan should show
-- "Index Only Scan using idx_prospects_agent_created_inc" with a
-- "Heap Fetches: 0" line.
--
--   EXPLAIN ANALYZE
--   SELECT id, full_name, nickname, phone FROM prospects
--   WHERE responsible_agent_id = <some_id>
--   ORDER BY created_at DESC LIMIT 50;
--
-- If you see "Heap Fetches: <large number>", run ANALYZE prospects; first
-- (the visibility map needs to be up to date for index-only scans to
-- avoid the heap).

-- Step 3: only after verifying the new index works, drop the old one.
-- DO NOT do this in the same run as the CREATE — verify the plan in EXPLAIN
-- ANALYZE first, then drop. Otherwise you risk a brief perf regression if
-- the new index isn't being picked.
--
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_prospects_agent_created;

-- ─────────────────── 2. Customers list view (same pattern) ──────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_agent_created_inc
    ON public.customers (responsible_agent_id, created_at DESC)
    INCLUDE (full_name, nickname, phone);

--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_customers_agent_created;
-- (Defer drop until plan is verified)

-- ─────────────────── 3. Activities-by-prospect list ─────────────────────────
-- The getActivitiesForProspect helper in data.js returns the latest
-- activities for a given prospect with these columns: activity_date,
-- activity_type, prospect_id. Tiny payload, perfect for index-only.
--
-- Existing index: idx_activities_prospect_date (prospect_id, activity_date DESC)
-- New variant adds activity_type to the leaf pages.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_prospect_date_inc
    ON public.activities (prospect_id, activity_date DESC)
    INCLUDE (activity_type);

--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_activities_prospect_date;
-- (Defer drop until plan is verified)

-- ─────────────────── 4. Activities-by-customer list ─────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_customer_date_inc
    ON public.activities (customer_id, activity_date DESC)
    INCLUDE (activity_type);

--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_activities_customer_date;
-- (Defer drop until plan is verified)

-- ────────────────────────── Validation queries ──────────────────────────────
-- After CREATE, run these to verify index-only scans:
--
-- 1. Confirm planner is choosing the new indexes:
--    EXPLAIN (ANALYZE, BUFFERS)
--    SELECT id, full_name, nickname, phone FROM prospects
--    WHERE responsible_agent_id = 'some-id-here'
--    ORDER BY created_at DESC LIMIT 50;
--    -- Look for: "Index Only Scan using idx_prospects_agent_created_inc"
--    -- Look for: "Heap Fetches: 0"
--    -- If non-zero heap fetches: run `VACUUM prospects;` to refresh the
--    -- visibility map, then re-test.
--
-- 2. Measure index sizes — INCLUDE makes them larger:
--    SELECT relname, pg_size_pretty(pg_relation_size(oid)) AS size
--    FROM pg_class
--    WHERE relname IN (
--      'idx_prospects_agent_created',     'idx_prospects_agent_created_inc',
--      'idx_customers_agent_created',     'idx_customers_agent_created_inc',
--      'idx_activities_prospect_date',    'idx_activities_prospect_date_inc',
--      'idx_activities_customer_date',    'idx_activities_customer_date_inc'
--    )
--    ORDER BY relname;
--    -- Each "_inc" index will be ~30-50% larger than its non-INCLUDE peer.

-- ────────────────────────── Rollback ────────────────────────────────────────
-- If index-only scans don't materialize OR storage cost is unacceptable:
--
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_prospects_agent_created_inc;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_customers_agent_created_inc;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_activities_prospect_date_inc;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_activities_customer_date_inc;
--
-- The original composites are still in place (we deliberately did NOT drop
-- them in this migration) so rollback is just deleting the new indexes —
-- no data loss, no perf regression.
