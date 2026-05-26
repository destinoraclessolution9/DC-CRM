-- Phase E: CRM performance indexes (2026-05-26)
-- Apply via Supabase SQL editor:
--   https://supabase.com/dashboard/project/remuwhxvzkzjtgbzqjaa/sql/new
-- All statements are idempotent (IF NOT EXISTS) and safe to re-run.

-- ============================================================
-- 1. Calendar hot path: activities scoped by agent + date range
-- ============================================================
-- renderCalendar() filters by (lead_agent_id, scheduled_date BETWEEN ...).
-- Without this composite index, every month-flip does a full scan of activities.
CREATE INDEX IF NOT EXISTS idx_activities_agent_date
    ON activities (lead_agent_id, scheduled_date DESC);

CREATE INDEX IF NOT EXISTS idx_activities_date
    ON activities (scheduled_date DESC);

-- co_agents is a JSONB column scanned for "is this user a co-agent?" lookups.
-- A GIN index lets us answer those with an index probe instead of a row scan.
CREATE INDEX IF NOT EXISTS idx_activities_co_agents_gin
    ON activities USING GIN (co_agents);

-- ============================================================
-- 2. Idempotency: reject duplicate submissions at the DB level
-- ============================================================
-- The frontend now sends a client_request_id (UUID) with each save. A unique
-- partial index lets the second tap fail fast with a 409 instead of inserting
-- a duplicate row. NULL is allowed for legacy rows that pre-date the column.
ALTER TABLE activities ADD COLUMN IF NOT EXISTS client_request_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_activities_client_request_id
    ON activities (client_request_id)
    WHERE client_request_id IS NOT NULL;

ALTER TABLE prospects ADD COLUMN IF NOT EXISTS client_request_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_prospects_client_request_id
    ON prospects (client_request_id)
    WHERE client_request_id IS NOT NULL;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS client_request_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_customers_client_request_id
    ON customers (client_request_id)
    WHERE client_request_id IS NOT NULL;

-- ============================================================
-- 3. Common hot-path indexes
-- ============================================================
-- Prospect / customer list views filter by assigned agent + recency.
CREATE INDEX IF NOT EXISTS idx_prospects_agent_created
    ON prospects (assigned_agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customers_agent_created
    ON customers (assigned_agent_id, created_at DESC);

-- Activity-by-prospect / by-customer lookups (profile drawers).
CREATE INDEX IF NOT EXISTS idx_activities_prospect
    ON activities (prospect_id) WHERE prospect_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activities_customer
    ON activities (customer_id) WHERE customer_id IS NOT NULL;

-- Event activity lookup (calendar dedupe by event_id + start_time).
CREATE INDEX IF NOT EXISTS idx_activities_event
    ON activities (event_id, start_time) WHERE event_id IS NOT NULL;

-- ============================================================
-- 4. Verify
-- ============================================================
-- After running, confirm with:
--   SELECT indexname FROM pg_indexes
--   WHERE tablename IN ('activities','prospects','customers')
--   ORDER BY indexname;
