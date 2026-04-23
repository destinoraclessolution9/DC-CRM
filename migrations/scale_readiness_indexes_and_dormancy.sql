-- ============================================================================
-- Scale Readiness Migration: Indexes + Dormancy Tracking
-- ============================================================================
-- Purpose:
--   1. Add denormalized `last_activity_date` to prospects for fast dormancy
--      filtering (avoids O(n×m) runtime scan across activities on every list).
--   2. Keep it in sync via a trigger on activities.
--   3. Add B-tree + GIN trigram indexes so search/filter scales past 100K rows.
--   4. Index activities(prospect_id, activity_date DESC) for per-prospect lookups.
--
-- Dormancy rule (enforced in application code): prospects whose
--   last_activity_date is older than 500 days AND whose updated_at is older
--   than 500 days are hidden from default lists and only loaded when an
--   agent explicitly searches for them.
--
-- Date: 2026-04-23
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- 2. Prospects: last_activity_date column + backfill
-- ---------------------------------------------------------------------------
ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS last_activity_date DATE;

-- Backfill from the most recent activity per prospect.
-- Fallback: updated_at::date, then created_at::date.
UPDATE prospects p
SET last_activity_date = GREATEST(
    COALESCE(sub.max_date, p.updated_at::date, p.created_at::date, CURRENT_DATE),
    COALESCE(p.updated_at::date, p.created_at::date, CURRENT_DATE)
)
FROM (
    SELECT prospect_id, MAX(activity_date) AS max_date
    FROM activities
    WHERE prospect_id IS NOT NULL
    GROUP BY prospect_id
) sub
WHERE p.id = sub.prospect_id
  AND p.last_activity_date IS NULL;

-- Rows with no activities at all: seed from updated_at / created_at.
UPDATE prospects
SET last_activity_date = COALESCE(updated_at::date, created_at::date, CURRENT_DATE)
WHERE last_activity_date IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Trigger: keep prospects.last_activity_date in sync with activities
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_prospect_last_activity_date()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        IF OLD.prospect_id IS NOT NULL THEN
            UPDATE prospects p
            SET last_activity_date = COALESCE(
                (SELECT MAX(activity_date) FROM activities
                 WHERE prospect_id = OLD.prospect_id),
                p.updated_at::date,
                p.created_at::date,
                CURRENT_DATE
            )
            WHERE p.id = OLD.prospect_id;
        END IF;
        RETURN OLD;
    END IF;

    IF NEW.prospect_id IS NOT NULL AND NEW.activity_date IS NOT NULL THEN
        UPDATE prospects
        SET last_activity_date = GREATEST(
            COALESCE(last_activity_date, '1970-01-01'::date),
            NEW.activity_date
        )
        WHERE id = NEW.prospect_id;
    END IF;

    -- If updating and the prospect_id changed, recompute for the old one too.
    IF (TG_OP = 'UPDATE' AND OLD.prospect_id IS DISTINCT FROM NEW.prospect_id
        AND OLD.prospect_id IS NOT NULL) THEN
        UPDATE prospects p
        SET last_activity_date = COALESCE(
            (SELECT MAX(activity_date) FROM activities
             WHERE prospect_id = OLD.prospect_id),
            p.updated_at::date,
            p.created_at::date,
            CURRENT_DATE
        )
        WHERE p.id = OLD.prospect_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_prospect_last_activity ON activities;
CREATE TRIGGER trg_sync_prospect_last_activity
AFTER INSERT OR UPDATE OR DELETE ON activities
FOR EACH ROW EXECUTE FUNCTION sync_prospect_last_activity_date();

-- ---------------------------------------------------------------------------
-- 4. Indexes on prospects
-- ---------------------------------------------------------------------------
-- Dormancy filtering (WHERE last_activity_date >= cutoff)
CREATE INDEX IF NOT EXISTS idx_prospects_last_activity_date
    ON prospects (last_activity_date DESC NULLS LAST);

-- Fast filtering by status
CREATE INDEX IF NOT EXISTS idx_prospects_status
    ON prospects (status);

-- Phone/email lookups (e.g. duplicate checks, search)
CREATE INDEX IF NOT EXISTS idx_prospects_phone
    ON prospects (phone) WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prospects_email
    ON prospects (email) WHERE email IS NOT NULL;

-- Agent scoping
CREATE INDEX IF NOT EXISTS idx_prospects_responsible_agent
    ON prospects (responsible_agent_id);

CREATE INDEX IF NOT EXISTS idx_prospects_cps_agent
    ON prospects (cps_agent_id);

-- Trigram GIN for fuzzy ILIKE '%term%' search (critical for Chinese names +
-- partial matches — a plain B-tree can't serve '%x%' queries).
CREATE INDEX IF NOT EXISTS idx_prospects_full_name_trgm
    ON prospects USING gin (full_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_prospects_nickname_trgm
    ON prospects USING gin (nickname gin_trgm_ops) WHERE nickname IS NOT NULL;

-- Pipeline + scoring filters
CREATE INDEX IF NOT EXISTS idx_prospects_pipeline_stage
    ON prospects (pipeline_stage);

CREATE INDEX IF NOT EXISTS idx_prospects_updated_at
    ON prospects (updated_at DESC);

-- ---------------------------------------------------------------------------
-- 5. Indexes on activities (the hottest table)
-- ---------------------------------------------------------------------------
-- Per-prospect latest activity (used everywhere: list row, tabs, reports)
CREATE INDEX IF NOT EXISTS idx_activities_prospect_date
    ON activities (prospect_id, activity_date DESC)
    WHERE prospect_id IS NOT NULL;

-- Per-customer lookups
CREATE INDEX IF NOT EXISTS idx_activities_customer_date
    ON activities (customer_id, activity_date DESC)
    WHERE customer_id IS NOT NULL;

-- Global date-range queries (dashboards, reports)
CREATE INDEX IF NOT EXISTS idx_activities_activity_date
    ON activities (activity_date DESC);

-- Recent-create lookups
CREATE INDEX IF NOT EXISTS idx_activities_created_at
    ON activities (created_at DESC);

-- Agent attribution
CREATE INDEX IF NOT EXISTS idx_activities_lead_agent
    ON activities (lead_agent_id);

-- ---------------------------------------------------------------------------
-- 6. Verify (will appear in the query result)
-- ---------------------------------------------------------------------------
SELECT
    'prospects' AS table_name,
    COUNT(*) AS total_rows,
    COUNT(last_activity_date) AS rows_with_last_activity,
    COUNT(*) FILTER (WHERE last_activity_date < CURRENT_DATE - INTERVAL '500 days') AS dormant_500d,
    COUNT(*) FILTER (WHERE last_activity_date >= CURRENT_DATE - INTERVAL '500 days') AS active_500d
FROM prospects;
