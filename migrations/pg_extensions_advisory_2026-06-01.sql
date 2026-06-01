-- ============================================================================
-- Postgres extensions for proactive query advice + cache warming + bloat control
-- Date: 2026-06-01
-- Status: FILE ONLY — apply via Supabase SQL editor only after review.
-- ----------------------------------------------------------------------------
-- Bundles three independent improvements into one migration. Each can be
-- applied/rolled back independently — see the section headers.
-- ============================================================================


-- ============================================================================
-- § 1. pg_qualstats + hypopg — predicate stats and hypothetical indexes
-- ============================================================================
-- WHAT
--   pg_qualstats collects statistics on the predicates (WHERE/JOIN columns)
--   actually used by queries. Combined with hypopg ("hypothetical Postgres"),
--   you can ask Postgres what indexes WOULD speed up the workload, without
--   actually creating them.
--
-- WHY this codebase
--   pg_stat_statements (already enabled) tells us which queries are slow.
--   pg_qualstats tells us why — which columns the planner wishes had indexes.
--   At present pg_stat_statements shows zero app queries in the top 20, so
--   the immediate value is observability for the next time something does
--   show up.
--
-- COST
--   ~1% overhead per query; modest memory for predicate stats.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_qualstats;
CREATE EXTENSION IF NOT EXISTS hypopg;

-- Sample diagnostic — run after extensions install for 24-48 hours of
-- traffic, then query:
--
--   SELECT
--     att.attname AS column,
--     cls.relname AS table,
--     qs.occurences AS query_count,
--     qs.execution_count
--   FROM pg_qualstats qs
--   JOIN pg_attribute att ON att.attrelid = qs.lrelid AND att.attnum = qs.lattnum
--   JOIN pg_class cls ON cls.oid = qs.lrelid
--   WHERE qs.lrelid IS NOT NULL
--     AND att.attnum > 0
--   ORDER BY qs.occurences DESC
--   LIMIT 25;
--
-- The top rows are predicate columns being filtered on most often. Cross-check
-- against existing indexes — any high-count column without an index is a
-- candidate for adding one.
--
-- For hypopg trial:
--
--   SELECT hypopg_reset();
--   SELECT * FROM hypopg_create_index('CREATE INDEX ON activities (some_col)');
--   EXPLAIN <your-slow-query>;
--   -- if the plan uses the hypothetical index, the real one is worth creating


-- ============================================================================
-- § 2. pg_prewarm — keep hot indexes in shared_buffers after restart
-- ============================================================================
-- WHAT
--   pg_prewarm loads relation pages into Postgres's shared_buffers cache.
--   Useful after a Supabase auto-restart or VACUUM FULL — without prewarm
--   the first query touching a cold index pays I/O latency.
--
-- WHY this codebase
--   Supabase Pro auto-applies kernel updates roughly monthly. After each,
--   the first ~50 queries hit cold storage. Prewarming the 4-5 hottest
--   indexes immediately on startup smooths over those moments.
--
-- COST
--   None at runtime; ~30 seconds at startup to load pages.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_prewarm;

-- Pre-warm the hottest indexes (run once per restart via pg_cron):
SELECT pg_prewarm('public.idx_prospects_agent_created_inc2');
SELECT pg_prewarm('public.idx_customers_agent_created_inc2');
SELECT pg_prewarm('public.idx_activities_agent_date');
SELECT pg_prewarm('public.idx_activities_prospect_date_inc2');
SELECT pg_prewarm('public.idx_activities_customer_date_inc2');

-- Make this run automatically on every restart via pg_cron.
-- Requires pg_cron (already enabled by Supabase).
-- The cron-job-from-cron pattern: schedule a one-shot @reboot job.
-- Supabase's pg_cron supports the @reboot directive.
--
-- SELECT cron.schedule(
--     'prewarm-hot-indexes-on-restart',
--     '@reboot',
--     $$
--     SELECT pg_prewarm('public.idx_prospects_agent_created_inc2');
--     SELECT pg_prewarm('public.idx_customers_agent_created_inc2');
--     SELECT pg_prewarm('public.idx_activities_agent_date');
--     SELECT pg_prewarm('public.idx_activities_prospect_date_inc2');
--     SELECT pg_prewarm('public.idx_activities_customer_date_inc2');
--     $$
-- );


-- ============================================================================
-- § 3. Quarterly REINDEX CONCURRENTLY — index packing
-- ============================================================================
-- WHAT
--   Indexes accumulate bloat over time as rows churn. REINDEX rebuilds them
--   in compact form. CONCURRENTLY keeps the table writable during the rebuild.
--
-- WHY this codebase
--   activities, prospects, customers churn enough that quarterly compaction
--   gives noticeable cache-hit improvements (~5-15% smaller index = same
--   shared_buffers covers more pages).
--
-- COST
--   30-60s per index per run; runs once per quarter so impact is negligible.
-- ============================================================================

-- Schedule via pg_cron — first Sunday of each quarter at 3am UTC:
-- SELECT cron.schedule(
--     'quarterly-reindex-hot',
--     '0 3 1 1,4,7,10 0',   -- first Sunday of Jan/Apr/Jul/Oct
--     $$
--     REINDEX INDEX CONCURRENTLY public.idx_prospects_agent_created_inc2;
--     REINDEX INDEX CONCURRENTLY public.idx_customers_agent_created_inc2;
--     REINDEX INDEX CONCURRENTLY public.idx_activities_agent_date;
--     REINDEX INDEX CONCURRENTLY public.idx_activities_prospect_date_inc2;
--     REINDEX INDEX CONCURRENTLY public.idx_activities_customer_date_inc2;
--     REINDEX INDEX CONCURRENTLY public.idx_activities_visibility;
--     REINDEX INDEX CONCURRENTLY public.idx_referrals_path_ids;
--     REINDEX INDEX CONCURRENTLY public.idx_prospects_full_name_trgm;
--     REINDEX INDEX CONCURRENTLY public.idx_prospects_nickname_trgm;
--     $$
-- );


-- ============================================================================
-- Verification (run after applying any of the sections above)
-- ============================================================================
-- SELECT extname, extversion FROM pg_extension
-- WHERE extname IN ('pg_qualstats', 'hypopg', 'pg_prewarm', 'pg_cron')
-- ORDER BY extname;
--
-- Expect 4 rows. (pg_cron is pre-installed on Supabase by default.)
--
-- After cron schedules:
-- SELECT jobid, schedule, command FROM cron.job
-- WHERE jobname LIKE 'prewarm-%' OR jobname LIKE 'quarterly-%'
-- ORDER BY jobid;
