-- ============================================================================
-- INCLUDE-column refinement — add `id` for true Index Only Scans
-- Date: 2026-06-01
-- Status: FILE ONLY — apply via Supabase SQL editor after review.
-- ----------------------------------------------------------------------------
-- Motivation:
-- The INCLUDE indexes from include_columns_2026-05-31.sql work — when the
-- planner picks them, query latency drops 15× (verified via EXPLAIN ANALYZE
-- with `SET enable_seqscan = off` on 2026-05-31).
--
-- However, the EXPLAIN plan showed `BITMAP INDEX SCAN → BITMAP HEAP SCAN`
-- rather than the optimal `Index Only Scan with Heap Fetches: 0`. Reason:
-- the typical SELECT shape is
--     SELECT id, full_name, nickname, phone FROM prospects WHERE ...
-- but the existing INCLUDE clause only covers `(full_name, nickname, phone)`.
-- `id` is the primary key, but Postgres still needs a heap fetch to read
-- the column unless it's listed in the index leaf pages.
--
-- This migration adds `id` to the INCLUDE clause on all 4 list-view indexes,
-- enabling true index-only scans → another ~50% latency cut on top of the
-- 15× already achieved. The index size grows by ~8 bytes per row (one bigint
-- per leaf entry).
--
-- ----------------------------------------------------------------------------
-- Safety:
-- - CONCURRENTLY → no exclusive lock on the table while the new index builds.
-- - Each statement must run alone (CONCURRENTLY cannot be in a transaction).
--   Paste one DROP+CREATE pair at a time in Supabase SQL editor.
-- - The non-_inc originals (idx_prospects_agent_created etc.) are still in
--   place as fallback — do NOT drop them in this migration.
-- ============================================================================

-- ─── Step 1: build new indexes with id in INCLUDE ───────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prospects_agent_created_inc2
    ON public.prospects (responsible_agent_id, created_at DESC)
    INCLUDE (id, full_name, nickname, phone);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_agent_created_inc2
    ON public.customers (responsible_agent_id, created_at DESC)
    INCLUDE (id, full_name, nickname, phone);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_prospect_date_inc2
    ON public.activities (prospect_id, activity_date DESC)
    INCLUDE (id, activity_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_customer_date_inc2
    ON public.activities (customer_id, activity_date DESC)
    INCLUDE (id, activity_type);

-- ─── Step 2: verify index-only scan (run after each CREATE) ─────────────────
-- VACUUM the table first to refresh the visibility map (required for
-- index-only scans to avoid heap fetches even when the index covers all
-- columns).
--
--   VACUUM prospects;
--
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id, full_name, nickname, phone
--   FROM prospects
--   WHERE responsible_agent_id = <some_id_with_many_rows>
--   ORDER BY created_at DESC LIMIT 50;
--   -- Look for: "Index Only Scan using idx_prospects_agent_created_inc2"
--   -- Look for: "Heap Fetches: 0"

-- ─── Step 3: only after verification, drop the v1 _inc indexes ──────────────
-- Run these only after confirming the _inc2 variants are picked AND show
-- Heap Fetches: 0 in EXPLAIN ANALYZE. Otherwise leave both in place.
--
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_prospects_agent_created_inc;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_customers_agent_created_inc;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_activities_prospect_date_inc;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_activities_customer_date_inc;
