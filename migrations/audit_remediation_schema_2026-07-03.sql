-- Audit remediation follow-up (2026-07-03)
-- Schema reconciliation for findings deferred from the automated code remediation.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. customers.score  — APPLIED LIVE 2026-07-03 (additive, pre-authorized).
--    features2.addScoreToCustomer writes customers.score, but the column was
--    missing (score_history table existed without a current-score column), so
--    every closing-activity score write silently failed. Additive, safe.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS score integer DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. journey_touchpoints assignee id type — RESOLVED ADDITIVELY (APPLIED LIVE 2026-07-03).
--    Problem: users.id / prospects.id are bigint, but assigned_to / completed_by
--    were uuid, so spawnTouchpointsForStage() (numeric ids) failed with 22P02 and
--    assignment / mark-done were broken.
--    Rather than a destructive TYPE change (which needs owner approval), we added
--    bigint sibling columns and rewired the client to use them. The legacy uuid
--    columns are left in place, unused (nothing reads them). Additive = safe.
ALTER TABLE journey_touchpoints ADD COLUMN IF NOT EXISTS assigned_to_id bigint;
ALTER TABLE journey_touchpoints ADD COLUMN IF NOT EXISTS completed_by_id bigint;
--
--    Client rewired to assigned_to_id / completed_by_id: chunks/script-journey.js
--    (spawn/escalate writes) and data.js (getJourneyTouchpointsDueToday /
--    getOverdueTouchpointsForAgent filters, updateTouchpointStatus completed stamp,
--    spawnTouchpointsForStage write).
--
--    OPTIONAL future cleanup (destructive — owner only): once confirmed, the legacy
--    uuid columns can be dropped:
--      ALTER TABLE journey_touchpoints DROP COLUMN assigned_to, DROP COLUMN completed_by;
