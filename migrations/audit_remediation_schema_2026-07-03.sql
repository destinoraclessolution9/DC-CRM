-- Audit remediation follow-up (2026-07-03)
-- Schema reconciliation for findings deferred from the automated code remediation.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. customers.score  — APPLIED LIVE 2026-07-03 (additive, pre-authorized).
--    features2.addScoreToCustomer writes customers.score, but the column was
--    missing (score_history table existed without a current-score column), so
--    every closing-activity score write silently failed. Additive, safe.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS score integer DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. journey_touchpoints.assigned_to / completed_by  — NOT YET APPLIED.
--    REQUIRES OWNER APPROVAL: this is a column TYPE change (destructive DDL),
--    excluded from the additive-DDL pre-authorization.
--    Rationale: users.id / prospects.id are bigint, but these columns are uuid,
--    so spawnTouchpointsForStage() (which writes numeric CRM ids) fails with
--    22P02 and journey-touchpoint assignment is broken. The table is currently
--    EMPTY (verified 0 rows on 2026-07-03), so the type change is zero-risk.
--    Run this in the Supabase SQL editor (project remuwhxvzkzjtgbzqjaa) or
--    approve running it via the Management API:
--
--    ALTER TABLE journey_touchpoints ALTER COLUMN assigned_to DROP DEFAULT;
--    ALTER TABLE journey_touchpoints ALTER COLUMN assigned_to TYPE bigint USING NULL::bigint;
--    ALTER TABLE journey_touchpoints ALTER COLUMN completed_by DROP DEFAULT;
--    ALTER TABLE journey_touchpoints ALTER COLUMN completed_by TYPE bigint USING NULL::bigint;
--
--    After it is applied, the existing spawn/assign code works unchanged.
