-- ============================================================================
-- Per-table autovacuum tuning + planner-stats refresh
-- Date: 2026-05-31
-- Status: FILE ONLY — apply via Supabase SQL editor only after review.
-- ----------------------------------------------------------------------------
-- Motivation:
-- 1. The pg_stat_user_tables diagnostic on 2026-05-31 showed n_live_tup values
--    badly out of sync with actual table sizes (e.g. prospects.n_live_tup=1
--    but pg_total_relation_size=16 MB). That means ANALYZE has not run
--    recently — the query planner is making decisions on stale statistics.
-- 2. The hottest write tables (activities, prospects, audit_logs,
--    login_attempts) accumulate dead tuples between autovacuum runs. Default
--    autovacuum thresholds (scale_factor 0.2 = 20% of table) are too lax for
--    write-heavy tables — bloat can grow significantly before autovacuum
--    triggers.
--
-- This migration does two things:
--   (A) Refresh planner stats on every public table via ANALYZE (cheap, safe,
--       no locks beyond a SHARE UPDATE EXCLUSIVE briefly).
--   (B) Tighten autovacuum + autoanalyze thresholds on the 5 highest-churn
--       tables so dead tuples don't accumulate.
--
-- Safety:
-- - ANALYZE acquires only a SHARE UPDATE EXCLUSIVE lock; reads + writes
--   continue normally.
-- - ALTER TABLE ... SET (autovacuum_* = X) takes an ACCESS EXCLUSIVE lock
--   but the change is metadata-only and completes in milliseconds.
-- - All settings are reversible via RESET (autovacuum_vacuum_scale_factor).
--
-- Application order:
--   Run (A) first to refresh stats. Run (B) as separate statements so each
--   one's brief lock doesn't pile up. CONCURRENTLY is not applicable to
--   ALTER TABLE SET (...).
-- ============================================================================

-- ─────────────────────────── (A) Refresh planner stats ──────────────────────
-- ANALYZE on the public schema; runs in parallel where Postgres allows.
-- Approximate runtime: <1 minute for a CRM at this scale.

ANALYZE VERBOSE public.activities;
ANALYZE VERBOSE public.prospects;
ANALYZE VERBOSE public.customers;
ANALYZE VERBOSE public.users;
ANALYZE VERBOSE public.referrals;
ANALYZE VERBOSE public.purchases;
ANALYZE VERBOSE public.events;
ANALYZE VERBOSE public.event_attendees;
ANALYZE VERBOSE public.notes;
ANALYZE VERBOSE public.transactions;
ANALYZE VERBOSE public.assignments;
ANALYZE VERBOSE public.audit_logs;
ANALYZE VERBOSE public.login_attempts;
ANALYZE VERBOSE public.score_history;
ANALYZE VERBOSE public.follow_up_drafts;
ANALYZE VERBOSE public.refill_reminders;

-- Or a single sweep if your project has many small tables and you don't
-- need per-table progress:
-- ANALYZE VERBOSE;

-- ─────────────────────── (B) Per-table autovacuum tuning ────────────────────
-- Default: autovacuum_vacuum_scale_factor = 0.20 (20% of table = trigger)
-- For high-churn tables we want this much tighter — 5% — so bloat stays
-- bounded even between busy update bursts.
--
-- autoanalyze_scale_factor (default 0.10) — also tighten to 0.02 so the
-- planner gets fresh stats more often.

ALTER TABLE public.activities SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.02,
    autovacuum_vacuum_cost_delay = 10
);

ALTER TABLE public.prospects SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.customers SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.audit_logs SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.05
);

ALTER TABLE public.login_attempts SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.05
);

ALTER TABLE public.score_history SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.05
);

-- ────────────────────────── Verification ────────────────────────────────────
-- After applying, confirm the per-table settings landed:
--
--   SELECT relname, reloptions
--   FROM pg_class
--   WHERE relkind = 'r'
--     AND relname IN (
--       'activities','prospects','customers',
--       'audit_logs','login_attempts','score_history'
--     );
--
-- Each row should show:
--   {autovacuum_vacuum_scale_factor=0.05,autovacuum_analyze_scale_factor=...}
--
-- Re-check pg_stat_user_tables a day or two later — n_live_tup should now
-- track actual row counts, and n_dead_tup should stay close to 0% bloat
-- on the tuned tables.

-- ────────────────────────── Rollback ────────────────────────────────────────
-- If any tuning causes unwanted CPU pressure from too-aggressive autovacuum:
--
--   ALTER TABLE public.activities RESET (
--       autovacuum_vacuum_scale_factor,
--       autovacuum_analyze_scale_factor,
--       autovacuum_vacuum_cost_delay
--   );
--   -- (repeat for each tuned table)
