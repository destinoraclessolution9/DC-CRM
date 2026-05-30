-- Supplemental perf indexes (2026-05-30)
-- Fills gaps from prior index migrations (perf_indexes_2026-05-26,
-- scale_readiness_indexes_and_dormancy, scale_30k_1k_2026-04-25, calendar_perf_2026-05-03).
--
-- All hot queries observed in production network logs as of 2026-05-30 that
-- weren't already indexed. Targets columns used as the FIRST predicate in a
-- WHERE clause (the parts a btree can actually accelerate). Skipped columns:
-- - users.* (table size <200 rows, full scan is faster than index lookup)
-- - security_incidents.* (small table)
-- - login_attempts.id (already PK)
--
-- Apply via Supabase SQL editor:
--   https://supabase.com/dashboard/project/remuwhxvzkzjtgbzqjaa/sql/new
-- All statements are idempotent (IF NOT EXISTS) and safe to re-run.

-- ────────────────────────────────────────────────────────────────────────────
-- SWR delta sync — these tables are polled with updated_at > X on every page
-- load. Missing index = sequential scan even when delta is empty.
-- ────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_login_attempts_updated_at
    ON login_attempts (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_follow_up_templates_updated_at
    ON follow_up_templates (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_follow_up_drafts_updated_at
    ON follow_up_drafts (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_refill_reminders_updated_at
    ON refill_reminders (updated_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- Status-filtered partial indexes — only index the "pending" rows since those
-- are the only ones the app ever fetches. Tiny index, fast lookup.
-- ────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_refill_reminders_pending
    ON refill_reminders (created_at DESC) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_follow_up_drafts_pending
    ON follow_up_drafts (created_at DESC) WHERE status = 'pending';

-- ────────────────────────────────────────────────────────────────────────────
-- Activities — visible-to-user filter combo used by calendar/list views.
-- Existing indexes cover (lead_agent_id, activity_date) and (activity_date),
-- but the OR'd visibility filter (`or=(lead_agent_id.in.(),visibility.in.(open,public))`)
-- benefits from a dedicated visibility index for the "show me public events" path.
-- ────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_activities_visibility
    ON activities (visibility, activity_date DESC)
    WHERE visibility IN ('open', 'public');

-- ────────────────────────────────────────────────────────────────────────────
-- Stats: rough size of the indexes added here. Run AFTER applying to confirm
-- nothing got bloated unexpectedly. Expected: each <5 MB.
-- ────────────────────────────────────────────────────────────────────────────
-- SELECT relname, pg_size_pretty(pg_relation_size(oid)) AS size
--   FROM pg_class
--  WHERE relname IN (
--    'idx_login_attempts_updated_at',
--    'idx_follow_up_templates_updated_at',
--    'idx_follow_up_drafts_updated_at',
--    'idx_refill_reminders_updated_at',
--    'idx_refill_reminders_pending',
--    'idx_follow_up_drafts_pending',
--    'idx_activities_visibility'
--  );
