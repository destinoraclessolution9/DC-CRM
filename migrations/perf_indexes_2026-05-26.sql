-- Phase E: CRM performance indexes (2026-05-26, corrected schema)
-- Apply via Supabase SQL editor:
--   https://supabase.com/dashboard/project/remuwhxvzkzjtgbzqjaa/sql/new
-- All statements are idempotent (IF NOT EXISTS) and safe to re-run.
--
-- Verified columns via information_schema 2026-05-26:
--   activities.activity_date  (NOT scheduled_date)
--   activities.lead_agent_id  (NOT assigned_agent_id)
--   prospects.responsible_agent_id  (NOT assigned_agent_id)
--   customers.responsible_agent_id

-- ============================================================
-- 1. Calendar hot path: activities scoped by agent + date range
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_activities_agent_date
    ON activities (lead_agent_id, activity_date DESC);

CREATE INDEX IF NOT EXISTS idx_activities_date
    ON activities (activity_date DESC);

-- co_agents JSONB scan → GIN index for "is user X a co-agent?" lookups.
CREATE INDEX IF NOT EXISTS idx_activities_co_agents_gin
    ON activities USING GIN (co_agents);

-- ============================================================
-- 2. Idempotency: reject duplicate submissions at the DB level
-- ============================================================
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
CREATE INDEX IF NOT EXISTS idx_prospects_agent_created
    ON prospects (responsible_agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customers_agent_created
    ON customers (responsible_agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activities_prospect
    ON activities (prospect_id) WHERE prospect_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activities_customer
    ON activities (customer_id) WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activities_event
    ON activities (event_id, start_time) WHERE event_id IS NOT NULL;
